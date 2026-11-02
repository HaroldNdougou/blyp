/**
 * WebSocket wallet (paiement reçu) — chemin rapide commerçant, FCM en secours.
 */
import { REALTIME_WS_URL, USE_MOCK_API } from "@/lib/config";
import { ingestPaymentReceivedEvent } from "@/lib/pay/ingestPaymentReceived";
import { AppState, type AppStateStatus } from "react-native";

let socket: WebSocket | null = null;
let accessToken: string | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

const PING_MS = 25_000;
const RECONNECT_MS = 2_800;

function clearPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function sendRaw(body: Record<string, unknown>): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(body));
    return true;
  } catch {
    return false;
  }
}

function schedulePing() {
  clearPing();
  pingTimer = setInterval(() => {
    sendRaw({ action: "ping" });
  }, PING_MS);
}

function scheduleReconnect() {
  if (!accessToken || !REALTIME_WS_URL || USE_MOCK_API) return;
  clearReconnect();
  reconnectTimer = setTimeout(() => connect(), RECONNECT_MS);
}

function connect() {
  if (!accessToken || !REALTIME_WS_URL || USE_MOCK_API) return;
  if (socket?.readyState === WebSocket.OPEN) return;
  try {
    socket?.close();
  } catch {
    /* noop */
  }
  const url = `${REALTIME_WS_URL}?token=${encodeURIComponent(accessToken)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    schedulePing();
  };
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(String(ev.data ?? "{}")) as Record<
        string,
        unknown
      >;
      if (data.type === "pong") return;
      if (ingestPaymentReceivedEvent(data)) return;
    } catch {
      /* ignore */
    }
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    clearPing();
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  };
}

export function ensureWalletRealtimeLink(token: string | null) {
  accessToken = token;
  if (!token || USE_MOCK_API || !REALTIME_WS_URL) {
    stopWalletRealtimeLink();
    return;
  }
  if (!appStateSub) {
    appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") connect();
    });
  }
  connect();
}

export function stopWalletRealtimeLink() {
  accessToken = null;
  clearPing();
  clearReconnect();
  appStateSub?.remove();
  appStateSub = null;
  try {
    socket?.close();
  } catch {
    /* noop */
  }
  socket = null;
}
