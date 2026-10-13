/**
 * Profils fictifs (dev uniquement) : 8 proches réguliers + fils pré-remplis
 * (textes + messages money). Servis localement par `request()` — rien en base AWS.
 * Mettre `DEMO_PROFILES_ENABLED` à `false` pour les retirer.
 */
import { ApiError } from "@/lib/api/errors";
import type {
  ChatMessage,
  Conversation,
  MoneyTransfer,
  MoneyTransferStatus,
} from "@/lib/api/types";
import i18n from "@/lib/i18n";
import { sortConversationsByActivity } from "@/lib/messagesCache";

export const DEMO_PROFILES_ENABLED = __DEV__;

const CONV_PREFIX = "demo-conv-";
const TRANSFER_PREFIX = "demo-tr-";
const PHONE_PREFIX = "600000";

type DemoLine = {
  mine: boolean;
  minutesAgo: number;
  text?: string;
  money?: { amount: number; status: MoneyTransferStatus; thanks?: boolean };
};

type DemoProfile = {
  key: string;
  name: string;
  /** 9 chiffres. */
  phone: string;
  /** Nb d’envois money (tri des proches sur Pay). */
  sends: number;
  lines: DemoLine[];
};

const DAY = 24 * 60;

const PROFILES: readonly DemoProfile[] = [
  {
    key: "1",
    name: "Chantal Mbarga",
    phone: `${PHONE_PREFIX}101`,
    sends: 9,
    lines: [
      { mine: false, minutesAgo: 3 * DAY, text: "Bonjour mon fils, tu vas bien ?" },
      { mine: true, minutesAgo: 3 * DAY - 5, text: "Oui maman, je t’envoie pour le marché" },
      { mine: true, minutesAgo: 3 * DAY - 6, money: { amount: 5000, status: "claimed", thanks: true } },
      { mine: false, minutesAgo: 3 * DAY - 30, text: "Merci beaucoup 🙏" },
      /** ~3 j (pas « 12 min ») : évite de dominer la liste inbox à chaque sync. */
      { mine: true, minutesAgo: 3 * DAY - 31, money: { amount: 2000, status: "pending" } },
    ],
  },
  {
    key: "2",
    name: "Paul Nkoulou",
    phone: `${PHONE_PREFIX}102`,
    sends: 8,
    lines: [
      { mine: false, minutesAgo: 2 * DAY, text: "La recette d’aujourd’hui ?" },
      { mine: true, minutesAgo: 2 * DAY - 10, money: { amount: 10000, status: "claimed" } },
      { mine: false, minutesAgo: 2 * DAY - 12, text: "Reçu, bonne route" },
      { mine: true, minutesAgo: 45, money: { amount: 8500, status: "claimed", thanks: true } },
    ],
  },
  {
    key: "3",
    name: "Aïcha Bello",
    phone: `${PHONE_PREFIX}103`,
    sends: 6,
    lines: [
      { mine: true, minutesAgo: DAY + 60, text: "Pour le taxi de demain" },
      { mine: true, minutesAgo: DAY + 59, money: { amount: 1500, status: "claimed" } },
      { mine: false, minutesAgo: 90, text: "Voilà pour le déjeuner 😉" },
      { mine: false, minutesAgo: 89, money: { amount: 1000, status: "pending" } },
    ],
  },
  {
    key: "4",
    name: "Serge Tchoupo",
    phone: `${PHONE_PREFIX}104`,
    sends: 5,
    lines: [
      { mine: false, minutesAgo: 5 * 60, text: "Tu es où ?" },
      { mine: true, minutesAgo: 5 * 60 - 2, text: "J’arrive dans 10 min" },
      { mine: true, minutesAgo: 5 * 60 - 3, money: { amount: 500, status: "claimed" } },
      { mine: false, minutesAgo: 5 * 60 - 4, text: "Bien reçu, merci 😄" },
    ],
  },
  {
    key: "5",
    name: "Mireille Ngo",
    phone: `${PHONE_PREFIX}105`,
    sends: 4,
    lines: [
      { mine: true, minutesAgo: 4 * DAY, money: { amount: 3000, status: "claimed" } },
      { mine: false, minutesAgo: 4 * DAY - 20, text: "Merci ma chérie ❤️" },
      { mine: true, minutesAgo: 8 * 60, money: { amount: 2500, status: "pending" } },
    ],
  },
  {
    key: "6",
    name: "Didier Fotso",
    phone: `${PHONE_PREFIX}106`,
    sends: 3,
    lines: [
      { mine: false, minutesAgo: 6 * DAY, text: "Frère, dépanne-moi un peu" },
      { mine: true, minutesAgo: 6 * DAY - 15, money: { amount: 2000, status: "claimed", thanks: true } },
      { mine: false, minutesAgo: 6 * DAY - 16, text: "Tu es un vrai 🙏" },
    ],
  },
  {
    key: "7",
    name: "Brice Essomba",
    phone: `${PHONE_PREFIX}107`,
    sends: 2,
    lines: [
      { mine: true, minutesAgo: 7 * DAY, text: "Pour le match de ce soir ⚽" },
      { mine: true, minutesAgo: 7 * DAY - 1, money: { amount: 1000, status: "claimed" } },
      { mine: false, minutesAgo: 7 * DAY - 40, text: "Bien reçu chef" },
    ],
  },
  {
    key: "8",
    name: "Nadège Owona",
    phone: `${PHONE_PREFIX}108`,
    sends: 2,
    lines: [
      { mine: false, minutesAgo: 9 * DAY, text: "Le crédit est fini 😭" },
      { mine: true, minutesAgo: 9 * DAY - 3, money: { amount: 500, status: "claimed", thanks: true } },
      { mine: false, minutesAgo: 9 * DAY - 4, text: "Merci !!" },
    ],
  },
];

/** Horodatages figés au chargement : snapshots stables (pas de re-render en boucle). */
const BASE_NOW = Date.now();

function isoAgo(minutes: number): string {
  return new Date(BASE_NOW - minutes * 60_000).toISOString();
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function peerUserId(p: DemoProfile): string {
  return `demo-user-${p.key}`;
}

function conversationId(p: DemoProfile): string {
  return `${CONV_PREFIX}${p.key}`;
}

/** Portraits stables (HTTPS) pour prévisualiser les avatars en dev. */
export function demoPeerAvatarUrl(p: DemoProfile | string): string {
  const key = typeof p === "string" ? p : p.key;
  return `https://i.pravatar.cc/256?u=blyp-demo-${key}`;
}

export function demoAvatarUrlForPhone(phone9: string | null | undefined): string | null {
  if (!DEMO_PROFILES_ENABLED) return null;
  const d = String(phone9 ?? "").replace(/\D/g, "").slice(-9);
  const p = PROFILES.find((x) => x.phone === d);
  return p ? demoPeerAvatarUrl(p) : null;
}

function previewOf(line: DemoLine): string {
  return line.money ? `💰 ${line.money.amount} F` : String(line.text ?? "");
}

function userIdFromToken(token: string | null | undefined): string {
  try {
    const part = String(token ?? "").split(".")[1];
    if (!part) return "me";
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64 + "===".slice((b64.length + 3) % 4);
    const payload = JSON.parse(globalThis.atob(pad)) as { sub?: unknown };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : "me";
  } catch {
    return "me";
  }
}

function buildMessages(p: DemoProfile, myId: string): ChatMessage[] {
  const cid = conversationId(p);
  const peerId = peerUserId(p);
  const peerFirst = firstName(p.name);
  return p.lines.map((line, i) => {
    const id = `demo-msg-${p.key}-${i}`;
    const createdAt = isoAgo(line.minutesAgo);
    const senderUserId = line.mine ? myId : peerId;
    let moneyTransfer: MoneyTransfer | null = null;
    if (line.money) {
      const { amount, status, thanks } = line.money;
      const recipientId = line.mine ? peerId : myId;
      const claimed = status === "claimed";
      moneyTransfer = {
        transferId: `${TRANSFER_PREFIX}${p.key}-${i}`,
        conversationId: cid,
        amountFcfa: amount,
        status,
        fromUserId: senderUserId,
        toUserId: recipientId,
        toPhone: line.mine ? p.phone : "",
        expiresAt: new Date(BASE_NOW + 7 * DAY * 60_000).toISOString(),
        claimedAt: claimed ? isoAgo(line.minutesAgo - 1) : null,
        claimedByUserId: claimed ? recipientId : null,
        claimedByFirstName: claimed && line.mine ? peerFirst : null,
        thanksUserId: thanks ? recipientId : null,
        thanksFirstName: thanks && line.mine ? peerFirst : null,
        createdAt,
      };
    }
    return {
      id,
      conversationId: cid,
      senderUserId,
      type: line.money ? "money" : "text",
      body: line.money ? null : (line.text ?? ""),
      moneyTransfer,
      reactions: [],
      createdAt,
      clientId: null,
    };
  });
}

const messagesCache = new Map<string, ChatMessage[]>();

function demoMessages(p: DemoProfile, myId: string): ChatMessage[] {
  const k = `${myId}::${p.key}`;
  let v = messagesCache.get(k);
  if (!v) {
    v = buildMessages(p, myId);
    messagesCache.set(k, v);
  }
  return v;
}

const DEMO_CONVERSATIONS: readonly Conversation[] = PROFILES.map((p) => {
  const last = p.lines[p.lines.length - 1];
  const at = isoAgo(last.minutesAgo);
  return {
    id: conversationId(p),
    type: "direct",
    peerName: p.name,
    peerPhone: `+237${p.phone}`,
    peerUserId: peerUserId(p),
    lastMessagePreview: previewOf(last),
    lastMessageType: last.money ? "money" : "text",
    lastMessageAt: at,
    lastMessageFromSelf: Boolean(last.mine),
    updatedAt: at,
    peerAvatarUrl: demoPeerAvatarUrl(p),
  };
});

export function isDemoPhone(phone9: string | null | undefined): boolean {
  if (!DEMO_PROFILES_ENABLED) return false;
  const d = String(phone9 ?? "").replace(/\D/g, "").slice(-9);
  return PROFILES.some((p) => p.phone === d);
}

export function isDemoPath(path: string): boolean {
  return (
    DEMO_PROFILES_ENABLED &&
    (path.startsWith(`/conversations/${CONV_PREFIX}`) ||
      path.startsWith(`/money-transfers/${TRANSFER_PREFIX}`))
  );
}

/** Proches fictifs pour Pay (après les vrais). */
export function demoRegularRecipients(): {
  phone: string;
  name: string;
  firstName: string;
  count: number;
}[] {
  if (!DEMO_PROFILES_ENABLED) return [];
  return PROFILES.map((p) => ({
    phone: p.phone,
    name: p.name,
    firstName: firstName(p.name),
    count: p.sends,
  }));
}

/** Liste serveur + fils fictifs (toujours sous les vraies discussions). */
export function withDemoConversations(items: Conversation[]): Conversation[] {
  if (!DEMO_PROFILES_ENABLED) return items;
  const real = items.filter((c) => !c.id.startsWith(CONV_PREFIX));
  return sortConversationsByActivity([...real, ...DEMO_CONVERSATIONS]);
}

/** Réponse locale pour les routes d’un fil fictif (lecture OK, écriture bloquée). */
export function demoApiResponse<T>(
  path: string,
  method: string,
  body: unknown,
  token: string | null,
): T {
  const m = path.match(/^\/conversations\/demo-conv-([^/]+)\/messages/);
  const profile = m ? PROFILES.find((p) => p.key === m[1]) : undefined;
  if (profile && method.toUpperCase() === "GET") {
    const at = new Date().toISOString();
    return {
      items: demoMessages(profile, userIdFromToken(token)),
      peerLastReadAt: at,
      peerLastDeliveredAt: at,
    } as T;
  }
  let type = "";
  try {
    type = String((JSON.parse(String(body ?? "{}")) as { type?: unknown }).type ?? "");
  } catch {
    /* corps non JSON */
  }
  if (profile && (type === "read" || type === "delivered" || type === "typing")) {
    return { ok: true, at: new Date().toISOString() } as T;
  }
  if (profile && method.toUpperCase() === "POST" && type === "image-presign") {
    const cid = conversationId(profile);
    return {
      uploadUrl: "mock://image",
      key: `image/${cid}/demo/mock.jpg`,
      contentType: "image/jpeg",
      expiresIn: 300,
    } as T;
  }
  if (profile && method.toUpperCase() === "POST" && type === "image-play") {
    return { url: "mock://image", expiresIn: 600 } as T;
  }
  if (profile && method.toUpperCase() === "POST" && type === "image") {
    let parsed: {
      key?: unknown;
      width?: unknown;
      height?: unknown;
      clientId?: unknown;
      caption?: unknown;
      body?: unknown;
    } = {};
    try {
      parsed = JSON.parse(String(body ?? "{}")) as typeof parsed;
    } catch {
      throw new ApiError(i18n.t("messages.imageSendFailed"), 400);
    }
    const key = String(parsed.key ?? "").trim();
    const clientId = String(parsed.clientId ?? "").trim() || `c-${Date.now()}`;
    const width = Math.max(0, Math.floor(Number(parsed.width) || 0));
    const height = Math.max(0, Math.floor(Number(parsed.height) || 0));
    if (!key) throw new ApiError(i18n.t("messages.imageSendFailed"), 400);
    const cap = String(parsed.caption ?? parsed.body ?? "").trim() || null;
    const myId = userIdFromToken(token);
    const now = new Date().toISOString();
    const message: ChatMessage = {
      id: `m-img-${clientId}`,
      conversationId: conversationId(profile),
      senderUserId: myId,
      type: "image",
      body: cap,
      moneyTransfer: null,
      image: { key, width, height },
      reactions: [],
      createdAt: now,
      clientId,
    };
    const k = `${myId}::${profile.key}`;
    const list = [...demoMessages(profile, myId), message];
    messagesCache.set(k, list);
    return { message } as T;
  }
  if (profile && method.toUpperCase() === "POST" && type === "text") {
    let parsed: { body?: unknown; clientId?: unknown } = {};
    try {
      parsed = JSON.parse(String(body ?? "{}")) as {
        body?: unknown;
        clientId?: unknown;
      };
    } catch {
      throw new ApiError(i18n.t("messages.sendFailed"), 400);
    }
    const text = String(parsed.body ?? "").trim();
    if (!text) throw new ApiError(i18n.t("messages.sendFailed"), 400);
    const clientId = String(parsed.clientId ?? "").trim() || `c-${Date.now()}`;
    const myId = userIdFromToken(token);
    const now = new Date().toISOString();
    const message: ChatMessage = {
      id: clientId,
      conversationId: conversationId(profile),
      senderUserId: myId,
      type: "text",
      body: text,
      moneyTransfer: null,
      reactions: [],
      createdAt: now,
      clientId,
    };
    const k = `${myId}::${profile.key}`;
    const list = [...demoMessages(profile, myId), message];
    messagesCache.set(k, list);
    return { message } as T;
  }
  throw new ApiError(i18n.t("demo.readOnly"), 400);
}
