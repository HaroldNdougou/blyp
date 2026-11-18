const BLYP_ACCOUNT_RE = /^BLYP-[UC]-[0-9A-HJKMNP-TV-Z]{10}$/;

export type BlypPayQrPayload = {
  accountId: string;
  name: string;
  amountFcfa: number | null;
  /** taxi | shop | soa_car | other */
  category?: string | null;
  /** 9 chiffres — uniquement si présent dans le QR (`p=`), sans réseau */
  phoneDigits?: string | null;
};

function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = search.startsWith("?") ? search.slice(1) : search;
  if (!q) return out;
  for (const part of q.split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
    const v = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : "");
    if (k) out[k] = v;
  }
  return out;
}

function normalizeAccount(raw: string | undefined): string | null {
  const id = String(raw ?? "").trim().toUpperCase();
  if (!id || !BLYP_ACCOUNT_RE.test(id)) return null;
  return id;
}

/** Uniquement `c=` du QR — jamais déduit du nom. */
function normalizeCategory(raw: string | undefined): string | null {
  const c = String(raw ?? "").trim().toLowerCase();
  if (c === "taxi") return "taxi";
  if (c === "shop" || c === "boutique" || c === "restaurant") return "shop";
  if (c === "soa_car" || c === "soa") return "soa_car";
  if (c === "other" || c === "autre") return "other";
  return null;
}

function normalizePhone(raw: string | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "").slice(-9);
  return d.length === 9 && d[0] === "6" ? d : null;
}

function payloadFromParams(params: Record<string, string>): BlypPayQrPayload | null {
  const accountId = normalizeAccount(params.a ?? params.account ?? params.accountId);
  if (!accountId) return null;
  const name = String(params.n ?? params.name ?? "").trim();
  const amountRaw = params.m ?? params.amount ?? "";
  const amountNum = amountRaw ? Math.floor(Number(amountRaw)) : NaN;
  const amountFcfa =
    Number.isFinite(amountNum) && amountNum > 0 ? amountNum : null;
  return {
    accountId,
    name: name || "—",
    amountFcfa,
    category: normalizeCategory(params.c ?? params.category),
    phoneDigits: normalizePhone(params.p ?? params.phone ?? params.phoneDigits),
  };
}

/** Contenu du QR (URL scheme Blyp). */
export function buildBlypPayQrUrl(input: {
  accountId: string;
  name: string;
  amountFcfa?: number | null;
  category?: string | null;
  phoneDigits?: string | null;
}): string {
  const accountId = normalizeAccount(input.accountId);
  if (!accountId) return "";
  const q = new URLSearchParams();
  q.set("v", "1");
  q.set("a", accountId);
  const name = String(input.name ?? "").trim();
  if (name) q.set("n", name);
  const amount = Math.floor(Number(input.amountFcfa));
  if (Number.isFinite(amount) && amount > 0) q.set("m", String(amount));
  const cat = normalizeCategory(input.category ?? undefined);
  if (cat) q.set("c", cat);
  const phone = normalizePhone(input.phoneDigits ?? undefined);
  if (phone) q.set("p", phone);
  return `blyp://pay?${q.toString()}`;
}

const ACCOUNT_FIND = /BLYP-[UC]-[0-9A-HJKMNP-TV-Z]{10}/i;

export function parseBlypPayQr(raw: string): BlypPayQrPayload | null {
  const s = String(raw ?? "").trim().replace(/^\uFEFF/, "");
  if (!s) return null;

  const lower = s.toLowerCase();
  if (lower.startsWith("blyp:") || lower.includes("blyp://")) {
    const qIdx = s.indexOf("?");
    if (qIdx >= 0) {
      const fromQ = payloadFromParams(parseQuery(s.slice(qIdx)));
      if (fromQ) return fromQ;
    }
  }

  if (/^https?:\/\//i.test(s)) {
    try {
      const url = new URL(s);
      const params = parseQuery(url.search);
      if (url.pathname.includes("pay") || params.a || params.account || params.accountId) {
        const fromUrl = payloadFromParams(params);
        if (fromUrl) return fromUrl;
      }
    } catch {
      /* ignore */
    }
  }

  const bare = normalizeAccount(s);
  if (bare) return { accountId: bare, name: "—", amountFcfa: null };

  const found = s.toUpperCase().match(ACCOUNT_FIND)?.[0];
  if (!found) return null;
  const accountId = normalizeAccount(found);
  if (!accountId) return null;
  const qIdx = s.indexOf("?");
  const params = qIdx >= 0 ? parseQuery(s.slice(qIdx)) : {};
  const name = String(params.n ?? params.name ?? "").trim();
  const amountRaw = params.m ?? params.amount ?? "";
  const amountNum = amountRaw ? Math.floor(Number(amountRaw)) : NaN;
  return {
    accountId,
    name: name || "—",
    amountFcfa: Number.isFinite(amountNum) && amountNum > 0 ? amountNum : null,
    category: normalizeCategory(params.c ?? params.category),
    phoneDigits: normalizePhone(params.p ?? params.phone ?? params.phoneDigits),
  };
}

export function blypPayQrToRecipient(payload: BlypPayQrPayload): {
  accountId: string;
  name: string;
  phoneDigits: string;
} {
  return {
    accountId: payload.accountId,
    name: payload.name,
    phoneDigits: payload.phoneDigits ?? "",
  };
}
