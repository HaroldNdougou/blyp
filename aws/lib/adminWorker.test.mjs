import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

process.env.TABLE_NAME = "blyp-test";
delete process.env.ADMIN_EMAIL;
delete process.env.ADMIN_SENDER_EMAIL;
delete process.env.ADMIN_PUSH_PHONE;

const { installFakeDynamo } = await import("./testing/fakeDynamo.mjs");
const { store, keyOf } = await installFakeDynamo();
const { handler } = await import("../handlers/adminEvents/index.mjs");
const { dailyStats, listEvents } = await import("./adminStore.mjs");

const record = (evt, id = "m-1") => ({ messageId: id, body: JSON.stringify(evt) });
const NOW = new Date().toISOString();

beforeEach(() => {
  store.clear();
  store.set(keyOf("USER#u1", "PROFILE"), {
    PK: "USER#u1", SK: "PROFILE", userId: "u1", firstName: "Awa", lastName: "N.",
    phone: "+237691234567", transactionPinHash: "h", createdAt: NOW,
  });
});

describe("worker d'événements admin", () => {
  test("traite un lot, déduplique les rejeux et ne plante pas sans config d'envoi", async () => {
    const signup = { id: "sig-000001-aaaa", type: "signup", userId: "u1", at: NOW, data: {} };
    const res1 = await handler({ Records: [record(signup), record(signup, "m-2")] });
    assert.deepEqual(res1.batchItemFailures, []);
    const day = new Date(Date.parse(NOW) + 3_600_000).toISOString().slice(0, 10);
    const [d] = await dailyStats(day, day);
    assert.equal(d.n_signup, 1, "le doublon SQS ne doit compter qu'une fois");
    const { items } = await listEvents({ limit: 10 });
    assert.equal(items.length, 1);
    assert.equal(items[0].name, "Awa N.");
  });

  test("événement invalide ou type inconnu : ignoré sans bloquer le lot", async () => {
    const bad = { id: "x", type: "hack", userId: "u1", at: NOW, data: {} };
    const good = { id: "log-000001-aaaa", type: "login", userId: "u1", at: NOW, data: {} };
    const res = await handler({ Records: [record(bad), record(good, "m-3"), { messageId: "m-4", body: "pas du json" }] });
    assert.deepEqual(res.batchItemFailures, [], "un message corrompu est écarté, pas rejoué");
    assert.equal((await listEvents({ limit: 10 })).items.length, 1);
  });

  test("message : destinataire résolu côté serveur, aucun contenu stocké", async () => {
    store.set(keyOf("CONV#c1", "MEMBER#u:u1"), { PK: "CONV#c1", SK: "MEMBER#u:u1", userId: "u1", displayName: "Awa" });
    store.set(keyOf("CONV#c1", "MEMBER#u:u2"), { PK: "CONV#c1", SK: "MEMBER#u:u2", userId: "u2", displayName: "Paul", phone: "+237677000000" });
    const msg = {
      id: "msg-000001-aaaa", type: "message", userId: "u1", at: NOW,
      data: { kind: "text", conversationId: "c1", messageId: "mm1" },
    };
    await handler({ Records: [record(msg)] });
    const [stored] = (await listEvents({ limit: 5 })).items;
    assert.equal(stored.data.toName, "Paul");
    assert.ok(!JSON.stringify(stored).includes("body"));
  });
});
