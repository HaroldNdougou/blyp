/**
 * Une WebSocket binaire par session — chat + wallet (évite 2 connexions / 2 pings).
 */
import { REALTIME_WS_URL, USE_MOCK_API } from "@/lib/config";
import { ingestSilentChatPush } from "@/lib/messages/live";
import { ingestPaymentReceivedEvent } from "@/lib/pay/ingestPaymentReceived";
import {
  decodeWsFrame,
  encodeClientAction,
  encodePingFrame,
} from "@/lib/realtime/blypWsFrame";
import {
  isNativeRealtimeEngineAvailable,
  startNativeRealtimeEngine,
  stopNativeRealtimeEngine,
  subscribeNativeRealtimePayload,
} from "@/lib/realtime/nativeRealtimeEngine";
import { AppState, InteractionManager, type AppStateStatus } from "react-native";

const PING_MS = 25_000;
const RECONNECT_MS = 2_800;

type Consumer = "chat" | "wallet";

let accessToken: string | null = null;
const consumers = new Set<Consumer>();
let socket: WebSocket | null = null;
let openConversationId: string | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;
let nativeUnsub: (() => void) | null = null;
let useNative = false;

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

function dispatchPayload(data: Record<string, unknown>) {
  if (data.type === "pong") return;
  if (ingestPaymentReceivedEvent(data, "ws_hub")) return;
  const type = String(data.type ?? "");
  if (
    type === "conversation_typing" ||
    type === "conversation_presence"
  ) {
    InteractionManager.runAfterInteractions(() => {
      ingestSilentChatPush(data);
    });
    return;
  }
  ingestSilentChatPush(data);
}

function flushPresence() {
  const cid = openConversationId;
  if (!cid || !accessToken || !consumers.has("chat")) return;
  sendHubAction({ action: "presence", conversationId: cid });
}

function schedulePing() {
  clearPing();
  pingTimer = setInterval(() => {
    sendHubAction({ action: "ping" });
    flushPresence();
  }, PING_MS);
}

function scheduleReconnect() {
  if (!accessToken || !REALTIME_WS_URL || USE_MOCK_API || consumers.size === 0) {
    return;
  }
  clearReconnect();
  reconnectTimer = setTimeout(() => connectJs(), RECONNECT_MS);
}

function sendHubAction(body: Record<string, unknown>): boolean {
  if (useNative) {
    void import("@/lib/realtime/nativeRealtimeEngine").then((m) =>
      m.sendNativeRealtimeAction(body),
    );
    return true;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    const frame = encodeClientAction(body);
    socket.send(frame);
    return true;
  } catch {
    return false;
  }
}

function connectJs() {
  if (useNative) return;
  if (!accessToken || !REALTIME_WS_URL || USE_MOCK_API || consumers.size === 0) {
    return;
  }
  if (socket?.readyState === WebSocket.OPEN) return;
  try {
    socket?.close();
  } catch {
    /* noop */
  }
  const url = `${REALTIME_WS_URL}?token=${encodeURIComponent(accessToken)}`;
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  socket = ws;
  ws.onopen = () => {
    schedulePing();
    flushPresence();
  };
  ws.onmessage = (ev) => {
    const data =
      typeof ev.data === "string"
        ? decodeWsFrame(ev.data)
        : decodeWsFrame(ev.data as ArrayBuffer);
    if (data) dispatchPayload(data);
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

async function connectNative() {
  if (!accessToken || !REALTIME_WS_URL || USE_MOCK_API || consumers.size === 0) {
    return;
  }
  useNative = isNativeRealtimeEngineAvailable();
  if (useNative) {
    try {
      try {
        socket?.close();
      } catch {
        /* noop */
      }
      socket = null;
      clearPing();
      nativeUnsub?.();
      nativeUnsub = subscribeNativeRealtimePayload((data) => dispatchPayload(data));
      await startNativeRealtimeEngine(REALTIME_WS_URL, accessToken);
      schedulePing();
      flushPresence();
      return;
    } catch {
      useNative = false;
      nativeUnsub?.();
      nativeUnsub = null;
      await stopNativeRealtimeEngine();
    }
  }
  connectJs();
}

function disconnectAll() {
  clearPing();
  clearReconnect();
  useNative = false;
  nativeUnsub?.();
  nativeUnsub = null;
  void stopNativeRealtimeEngine();
  try {
    socket?.close();
  } catch {
    /* noop */
  }
  socket = null;
}

function syncConnection() {
  if (!accessToken || USE_MOCK_API || !REALTIME_WS_URL || consumers.size === 0) {
    disconnectAll();
    return;
  }
  if (!appStateSub) {
    appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") void connectNative();
    });
  }
  void connectNative();
}

export function acquireRealtimeHub(consumer: Consumer, token: string | null) {
  accessToken = token;
  if (!token) {
    consumers.clear();
    disconnectAll();
    return;
  }
  consumers.add(consumer);
  syncConnection();
}

export function releaseRealtimeHub(consumer: Consumer) {
  consumers.delete(consumer);
  if (consumers.size === 0) {
    disconnectAll();
    appStateSub?.remove();
    appStateSub = null;
    return;
  }
  syncConnection();
}

export function kickRealtimeHub() {
  if (!accessToken || USE_MOCK_API || !REALTIME_WS_URL) return;
  disconnectAll();
  consumers.forEach((c) => consumers.add(c));
  syncConnection();
}

export function setRealtimeOpenConversation(conversationId: string | null) {
  openConversationId = conversationId;
  flushPresence();
}

export function sendRealtimeTyping(conversationId: string, on: boolean) {
  if (!accessToken || !consumers.has("chat")) return;
  if (sendHubAction({ action: "typing", conversationId, on })) return;
  void import("@/lib/api/client").then((api) => {
    void api.sendConversationTyping(accessToken!, conversationId, on).catch(
      () => {},
    );
  });
}

/** Ping binaire minimal (tests / debug). */
export function sendRealtimePingNow(): void {
  if (useNative) {
    void import("@/lib/realtime/nativeRealtimeEngine").then((m) =>
      m.sendNativeRealtimeRaw(encodePingFrame()),
    );
    return;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(encodePingFrame());
}
