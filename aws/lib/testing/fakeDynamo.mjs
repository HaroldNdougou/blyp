/** Faux DynamoDB en mémoire — uniquement ce qu'utilisent les modules admin (tests). */
export async function installFakeDynamo() {
  const { getDocClient } = await import("../dynamodb.mjs");

  const store = new Map();
  const keyOf = (pk, sk) => `${pk}\u0000${sk}`;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function condFails(item, cond, values) {
    if (!cond) return false;
    if (cond.includes("attribute_not_exists(PK)")) return Boolean(item);
    if (cond.includes("attribute_exists(PK)")) return !item;
    const m = cond.match(/balanceFcfa >= (:\w+)/);
    if (m) return !item || Number(item.balanceFcfa) < values[m[1]];
    return false;
  }

  function condErr() {
    const e = new Error("conditional");
    e.name = "ConditionalCheckFailedException";
    return e;
  }

  function applyUpdate(item, input) {
    const expr = input.UpdateExpression;
    const names = input.ExpressionAttributeNames ?? {};
    const vals = input.ExpressionAttributeValues ?? {};
    const r = (n) => names[n] ?? n;
    const bal = expr.match(/SET balanceFcfa = if_not_exists\(balanceFcfa, (:\w+)\) \+ (:\w+)/);
    if (bal) {
      item.balanceFcfa = Number(item.balanceFcfa ?? vals[bal[1]]) + vals[bal[2]];
      return;
    }
    const dec = expr.match(/SET balanceFcfa = balanceFcfa - (:\w+)/);
    if (dec) {
      item.balanceFcfa = Number(item.balanceFcfa) - vals[dec[1]];
      return;
    }
    const add = expr.match(/ADD (.+?)(?= SET|$)/);
    if (add) {
      for (const part of add[1].split(",")) {
        const [n, v] = part.trim().split(/\s+/);
        item[r(n)] = (item[r(n)] ?? 0) + vals[v];
      }
    }
    const set = expr.match(/SET (.+)$/);
    if (set) {
      for (const part of set[1].split(",")) {
        const [n, , v] = part.trim().split(/\s+/);
        if (v && v.startsWith(":")) item[r(n)] = vals[v];
      }
    }
  }

  function runQuery(input) {
    const v = input.ExpressionAttributeValues;
    const cond = input.KeyConditionExpression;
    let rows = [...store.values()].filter((it) => it.PK === v[":pk"]);
    if (cond.includes("SK > :after")) rows = rows.filter((it) => it.SK > v[":after"]);
    const bw = cond.match(/begins_with\(SK, (:\w+)\)/);
    if (bw) rows = rows.filter((it) => it.SK.startsWith(v[bw[1]]));
    rows.sort((a, b) => (a.SK < b.SK ? -1 : 1));
    if (input.ScanIndexForward === false) rows.reverse();
    if (input.Limit) rows = rows.slice(0, input.Limit);
    return { Items: rows.map(clone) };
  }

  function send(cmd) {
    const input = cmd.input;
    switch (cmd.constructor.name) {
      case "PutCommand": {
        const k = keyOf(input.Item.PK, input.Item.SK);
        if (condFails(store.get(k), input.ConditionExpression, input.ExpressionAttributeValues)) {
          throw condErr();
        }
        store.set(k, clone(input.Item));
        return {};
      }
      case "GetCommand":
        return { Item: clone(store.get(keyOf(input.Key.PK, input.Key.SK)) ?? null) ?? undefined };
      case "UpdateCommand": {
        const k = keyOf(input.Key.PK, input.Key.SK);
        const cur = store.get(k);
        if (condFails(cur, input.ConditionExpression, input.ExpressionAttributeValues)) throw condErr();
        const item = cur ?? { PK: input.Key.PK, SK: input.Key.SK };
        applyUpdate(item, input);
        store.set(k, item);
        return { Attributes: clone(item) };
      }
      case "QueryCommand":
        return runQuery(input);
      case "BatchGetCommand": {
        const [table, spec] = Object.entries(input.RequestItems)[0];
        const items = spec.Keys.map((k) => store.get(keyOf(k.PK, k.SK))).filter(Boolean).map(clone);
        return { Responses: { [table]: items } };
      }
      case "TransactWriteCommand": {
        const snapshot = new Map([...store].map(([k, v]) => [k, clone(v)]));
        try {
          for (const t of input.TransactItems) {
            if (t.Put) send({ constructor: { name: "PutCommand" }, input: t.Put });
            if (t.Update) send({ constructor: { name: "UpdateCommand" }, input: t.Update });
          }
        } catch (err) {
          store.clear();
          for (const [k, v] of snapshot) store.set(k, v);
          const e = new Error("tx cancelled");
          e.name = "TransactionCanceledException";
          throw e;
        }
        return {};
      }
      case "ScanCommand": {
        const v = input.ExpressionAttributeValues;
        const f = input.FilterExpression;
        let rows = [...store.values()];
        if (f.includes(":p")) rows = rows.filter((it) => it.SK === v[":p"] && it.PK.startsWith(v[":u"]));
        else if (f.includes(":b")) {
          rows = rows.filter((it) => it.SK === v[":b"] && (it.PK.startsWith(v[":u"]) || it.PK.startsWith(v[":c"])));
        }
        return { Items: rows.map(clone) };
      }
      case "BatchWriteCommand": {
        for (const reqs of Object.values(input.RequestItems)) {
          for (const r of reqs) {
            if (r.DeleteRequest) store.delete(keyOf(r.DeleteRequest.Key.PK, r.DeleteRequest.Key.SK));
          }
        }
        return { UnprocessedItems: {} };
      }
      default:
        throw new Error(`fake dynamo: unsupported ${cmd.constructor.name}`);
    }
  }

  getDocClient().send = async (cmd) => send(cmd);
  return { store, keyOf };
}
