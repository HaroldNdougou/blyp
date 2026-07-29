/**
 * Client minimal PawaPay Merchant API v2 (sandbox / prod).
 * @see https://docs.pawapay.io/v2/docs/deposits
 */

export function getPawapayConfig() {
  const token = (process.env.PAWAPAY_API_TOKEN || "").trim();
  const baseUrl = (
    process.env.PAWAPAY_API_BASE_URL || "https://api.sandbox.pawapay.io"
  ).replace(/\/$/, "");
  const currency = (process.env.PAWAPAY_DEPOSIT_CURRENCY || "XAF").trim();
  const defaultProvider = (
    process.env.PAWAPAY_DEFAULT_MM_PROVIDER || "MTN_MOMO_CMR"
  ).trim();
  return {
    token,
    baseUrl,
    currency,
    defaultProvider,
    configured: Boolean(token),
  };
}

const CM_MM_PROVIDERS = new Set(["MTN_MOMO_CMR", "ORANGE_CMR"]);

export function normalizeMmProvider(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return CM_MM_PROVIDERS.has(s) ? s : null;
}

/**
 * MSISDN pour PawaPay : chiffres uniquement, indicatif pays sans « + » (ex. 237653456789).
 */
export function digitsForPawapayPayer(phoneFromDb, overrideRaw) {
  if (overrideRaw != null && String(overrideRaw).trim()) {
    const o = String(overrideRaw).replace(/\D/g, "");
    if (o.length === 9 && /^6\d{8}$/.test(o)) return `237${o}`;
    if (o.startsWith("237") && o.length >= 12) return o.slice(0, 12);
    if (o.length >= 10) return o;
    return null;
  }
  const d = String(phoneFromDb ?? "").replace(/\D/g, "");
  if (d.startsWith("237") && d.length >= 12) return d.slice(0, 12);
  if (d.length >= 9) {
    const last9 = d.slice(-9);
    if (/^6\d{8}$/.test(last9)) return `237${last9}`;
  }
  return null;
}

/** Heuristique Cameroun : numéros test Orange 23769…, MTN 23765… */
export function inferCameroonMomoProvider(phoneDigits) {
  const d = String(phoneDigits).replace(/\D/g, "");
  if (!d.startsWith("237") || d.length < 12) {
    return getPawapayConfig().defaultProvider;
  }
  const rest = d.slice(3);
  if (rest.startsWith("69")) return "ORANGE_CMR";
  return "MTN_MOMO_CMR";
}

/**
 * @param {object} p
 * @param {string} p.depositId - UUID v4
 * @param {number} p.amountFcfa
 * @param {string} p.currency
 * @param {string} p.phoneDigits
 * @param {string} p.provider - ex. MTN_MOMO_CMR
 * @param {string} [p.clientReferenceId]
 */
export async function pawapayInitiateDeposit({
  depositId,
  amountFcfa,
  currency,
  phoneDigits,
  provider,
  clientReferenceId,
}) {
  const { token, baseUrl } = getPawapayConfig();
  if (!token) {
    return {
      httpOk: false,
      httpStatus: 0,
      json: null,
      error: "PAWAPAY_API_TOKEN manquant",
    };
  }
  const url = `${baseUrl}/v2/deposits`;
  const body = {
    depositId,
    amount: String(amountFcfa),
    currency,
    payer: {
      type: "MMO",
      accountDetails: {
        phoneNumber: phoneDigits.replace(/\D/g, ""),
        provider,
      },
    },
    customerMessage: "Blyp recharge",
  };
  if (clientReferenceId) body.clientReferenceId = clientReferenceId;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      httpOk: false,
      httpStatus: 0,
      json: null,
      error: msg,
    };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return {
    httpOk: res.ok,
    httpStatus: res.status,
    json,
    error: null,
  };
}

export async function pawapayGetDepositStatus(depositId) {
  const { token, baseUrl } = getPawapayConfig();
  if (!token) return { httpStatus: 0, json: null, error: "no_token" };
  const url = `${baseUrl}/v2/deposits/${encodeURIComponent(depositId)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch (e) {
    return {
      httpStatus: 0,
      json: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }
  return { httpStatus: res.status, json, error: null };
}
