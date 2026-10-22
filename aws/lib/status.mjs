import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { publicAvatarUrl } from "./avatar.mjs";
import { getDocClient, getTableName, ttlFromNowMs } from "./dynamodb.mjs";
import { presignStatusPlay, isOwnedStatusKey } from "./media.mjs";
import { listConversations } from "./messaging.mjs";
import { getUserProfile, userPk } from "./user.mjs";

const doc = getDocClient();
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
const TEXT_BG_COUNT = 8;
const TEXT_FONT_COUNT = 3;

function clampTextStyleIndex(index, max) {
  const n = Number(index);
  if (!Number.isFinite(n) || max <= 0) return 0;
  return Math.max(0, Math.min(max - 1, Math.floor(n)));
}

function normalizeTextStyleInput(raw) {
  if (!raw || typeof raw !== "object") {
    return { bgIndex: 0, fontIndex: 0 };
  }
  return {
    bgIndex: clampTextStyleIndex(raw.bgIndex, TEXT_BG_COUNT),
    fontIndex: clampTextStyleIndex(raw.fontIndex, TEXT_FONT_COUNT),
  };
}

function textStyleFromItem(it) {
  const ts = it?.textStyle;
  if (!ts || typeof ts !== "object") return null;
  return {
    bgIndex: clampTextStyleIndex(ts.bgIndex, TEXT_BG_COUNT),
    fontIndex: clampTextStyleIndex(ts.fontIndex, TEXT_FONT_COUNT),
  };
}

function statusSk(createdAtMs, postId) {
  return `STATUS#${String(createdAtMs).padStart(13, "0")}#${postId}`;
}

function statusViewSk(postId) {
  return `STATUSVIEW#${postId}`;
}

function statusMetaPk(postId) {
  return `STATUS#${postId}`;
}

function displayNameFromProfile(profile, fallbackPhone) {
  const f = profile?.firstName?.trim() ?? "";
  const l = profile?.lastName?.trim() ?? "";
  const name = `${f} ${l}`.trim();
  if (name) return name;
  return fallbackPhone || "Blyp";
}

async function listPostsForUser(authorId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": userPk(authorId),
        ":sk": "STATUS#",
      },
    }),
  );
  const now = Date.now();
  return (res.Items ?? [])
    .filter((it) => {
      const exp = Date.parse(String(it.expiresAtIso ?? ""));
      return !Number.isFinite(exp) || exp > now;
    })
    .map((it) => ({
      id: String(it.postId ?? ""),
      userId: String(it.userId ?? authorId),
      kind: it.kind === "text" ? "text" : "image",
      mediaKey: String(it.mediaKey ?? "").trim() || null,
      text: it.text ? String(it.text) : null,
      textStyle: it.kind === "text" ? textStyleFromItem(it) : null,
      createdAt: String(it.createdAt ?? ""),
      expiresAt: String(it.expiresAtIso ?? ""),
    }))
    .filter((p) => p.id)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

async function loadViewedPostIds(viewerId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": userPk(viewerId),
        ":sk": "STATUSVIEW#",
      },
      ProjectionExpression: "SK",
    }),
  );
  const set = new Set();
  for (const it of res.Items ?? []) {
    const sk = String(it.SK ?? "");
    const id = sk.replace(/^STATUSVIEW#/, "");
    if (id) set.add(id);
  }
  return set;
}

async function postToPublic(post) {
  let mediaUrl = null;
  if (post.kind === "image" && post.mediaKey) {
    const play = await presignStatusPlay(post.mediaKey);
    if (play.url) mediaUrl = play.url;
  }
  const out = {
    id: post.id,
    userId: post.userId,
    kind: post.kind,
    mediaUrl,
    text: post.text,
    createdAt: post.createdAt,
    expiresAt: post.expiresAt,
  };
  if (post.kind === "text" && post.textStyle) {
    out.textStyle = post.textStyle;
  }
  return out;
}

async function peerAvatarForUser(peerUserId, peerPhone) {
  if (!peerUserId) return null;
  const profile = await getUserProfile(peerUserId);
  const phone = profile?.phone ?? peerPhone;
  if (!phone) return null;
  const nine = String(phone).replace(/\D/g, "").slice(-9);
  const v = profile?.avatarUpdatedAt
    ? Date.parse(profile.avatarUpdatedAt)
    : 0;
  return publicAvatarUrl(nine, v);
}

export async function listStatusFeed(userId) {
  const myProfile = await getUserProfile(userId);
  const myPhone = myProfile?.phone ?? null;
  const myName = displayNameFromProfile(myProfile, myPhone);
  const myAvatar = myPhone
    ? publicAvatarUrl(
        String(myPhone).replace(/\D/g, "").slice(-9),
        myProfile?.avatarUpdatedAt
          ? Date.parse(myProfile.avatarUpdatedAt)
          : 0,
      )
    : null;

  const convs = await listConversations(userId);
  const viewed = await loadViewedPostIds(userId);
  const items = [];
  const seenUsers = new Set();

  const pushRow = async (
    targetUserId,
    displayName,
    peerPhone,
    avatarUrl,
  ) => {
    if (!targetUserId || seenUsers.has(targetUserId)) return;
    seenUsers.add(targetUserId);
    const rawPosts = await listPostsForUser(targetUserId);
    if (rawPosts.length === 0 && targetUserId !== userId) return;
    const posts = await Promise.all(rawPosts.map((p) => postToPublic(p)));
    const hasUnseen = posts.some((p) => !viewed.has(p.id));
    items.push({
      userId: targetUserId,
      displayName,
      peerPhone,
      avatarUrl,
      posts,
      hasUnseen,
    });
  };

  await pushRow(userId, myName, myPhone, myAvatar);

  for (const c of convs) {
    if (!c.peerUserId) continue;
    const avatar = await peerAvatarForUser(c.peerUserId, c.peerPhone);
    await pushRow(c.peerUserId, c.peerName, c.peerPhone, avatar);
  }

  items.sort((a, b) => {
    if (a.userId === userId) return -1;
    if (b.userId === userId) return 1;
    if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
    const ta = a.posts[a.posts.length - 1]?.createdAt ?? "";
    const tb = b.posts[b.posts.length - 1]?.createdAt ?? "";
    return Date.parse(tb) - Date.parse(ta);
  });

  return { items, myUserId: userId };
}

export async function publishStatus(userId, body) {
  const kind = body?.kind === "text" ? "text" : "image";
  const text = String(body?.text ?? "").trim() || null;
  const mediaKey =
    kind === "image" ? String(body?.mediaKey ?? "").trim() || null : null;

  if (kind === "image") {
    if (!mediaKey || !isOwnedStatusKey(mediaKey, userId)) {
      return { error: "MEDIA_INVALID" };
    }
  } else if (!text) {
    return { error: "TEXT_REQUIRED" };
  }

  const textStyle = kind === "text" ? normalizeTextStyleInput(body?.textStyle) : null;

  const postId = randomUUID();
  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const expiresAtIso = new Date(createdAtMs + STATUS_TTL_MS).toISOString();
  const expiresAt = ttlFromNowMs(STATUS_TTL_MS);

  const statusItem = {
    PK: userPk(userId),
    SK: statusSk(createdAtMs, postId),
    entityType: "STATUS",
    postId,
    userId,
    kind,
    createdAt,
    expiresAtIso,
    expiresAt,
  };
  if (mediaKey) statusItem.mediaKey = mediaKey;
  if (text) statusItem.text = text;
  if (textStyle) statusItem.textStyle = textStyle;

  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: statusItem,
    }),
  );

  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: statusMetaPk(postId),
        SK: "META",
        entityType: "STATUS_META",
        postId,
        userId,
        expiresAtIso,
        expiresAt,
      },
    }),
  );

  const post = await postToPublic({
    id: postId,
    userId,
    kind,
    mediaKey,
    text,
    textStyle,
    createdAt,
    expiresAt: expiresAtIso,
  });
  return { post };
}

async function getStatusMeta(postId) {
  const res = await doc.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { PK: statusMetaPk(postId), SK: "META" },
    }),
  );
  return res.Item ?? null;
}

export async function recordStatusView(viewerId, postId) {
  const id = String(postId ?? "").trim();
  if (!id) return { error: "ID_REQUIRED" };
  const meta = await getStatusMeta(id);
  if (!meta) return { error: "NOT_FOUND" };
  const exp = Date.parse(String(meta.expiresAtIso ?? ""));
  if (Number.isFinite(exp) && exp <= Date.now()) {
    return { error: "NOT_FOUND" };
  }
  const expiresAt =
    Number(meta.expiresAt) > 0
      ? meta.expiresAt
      : ttlFromNowMs(Math.max(0, exp - Date.now()));

  await doc.send(
    new PutCommand({
      TableName: getTableName(),
      Item: {
        PK: userPk(viewerId),
        SK: statusViewSk(id),
        entityType: "STATUS_VIEW",
        postId: id,
        viewedAt: new Date().toISOString(),
        expiresAt,
      },
    }),
  );
  return { ok: true };
}

export async function deleteMyStatuses(userId) {
  const res = await doc.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: {
        ":pk": userPk(userId),
        ":sk": "STATUS#",
      },
    }),
  );
  for (const it of res.Items ?? []) {
    const postId = String(it.postId ?? "").trim();
    await doc.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { PK: it.PK, SK: it.SK },
      }),
    );
    if (postId) {
      await doc.send(
        new DeleteCommand({
          TableName: getTableName(),
          Key: { PK: statusMetaPk(postId), SK: "META" },
        }),
      );
    }
  }
  return { ok: true };
}
