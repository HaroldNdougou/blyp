import { StatusRing } from "@/components/status/StatusRing";
import { createStatusStyles } from "@/components/status/statusStyles";
import { resolveStatusTextAppearance } from "@/lib/status/textStatusPalette";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { StatusFeedItem, StatusPost } from "@/lib/api/types";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import {
  activePosts,
  applyStatusFeedSnapshot,
  ensureStatusFeedPlaceholder,
  getStatusFeedSnapshot,
  getStatusMyUserId,
  removeMyStatusPosts,
  statusFeedHasPeerPosts,
  statusViewStartIndex,
  subscribeStatusFeed,
} from "@/lib/status/statusCache";
import {
  applyDemoStatusFeedNow,
  syncStatusFeedFromNetwork,
} from "@/lib/status/statusSync";
import { router } from "expo-router";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

function lastActivePost(row: StatusFeedItem): StatusPost | null {
  const posts = activePosts(row.posts);
  return posts.length > 0 ? posts[posts.length - 1]! : null;
}

type StatusCardProps = {
  row: StatusFeedItem;
  ring: "unseen" | "seen" | "add" | "none";
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  isAdd?: boolean;
  centerLabel?: boolean;
  showAddBadge?: boolean;
  onAddBadgePress?: () => void;
  onAvatarPress?: () => void;
};

const StatusActusCard = React.memo(function StatusActusCard({
  row,
  ring,
  label,
  onPress,
  onLongPress,
  isAdd,
  centerLabel,
  showAddBadge,
  onAddBadgePress,
  onAvatarPress,
}: StatusCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const post = lastActivePost(row);
  const previewUri =
    post?.kind === "image" && post.mediaUrl ? post.mediaUrl : null;
  const showTextPreview = !previewUri && !!post?.text;
  const textPreviewLook =
    showTextPreview && post?.kind === "text"
      ? resolveStatusTextAppearance(post.textStyle)
      : null;
  const addEmpty = isAdd && !previewUri && !post?.text;

  return (
    <Pressable
      style={styles.actusCardWrap}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
    >
      <View style={styles.actusCard}>
        {previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={styles.actusCardMedia}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.actusCardMedia,
              {
                backgroundColor: addEmpty
                  ? colors.surfaceMuted
                  : (textPreviewLook?.backgroundColor ?? colors.accentDark),
                alignItems: "center",
                justifyContent: "center",
                padding: 8,
              },
            ]}
          >
            {showTextPreview ? (
              <Text
                style={[
                  styles.actusCardTextPreview,
                  textPreviewLook && {
                    fontSize: Math.round(textPreviewLook.font.fontSize * 0.45),
                    fontWeight: textPreviewLook.font.fontWeight,
                    fontStyle: textPreviewLook.font.fontStyle ?? "normal",
                  },
                ]}
                numberOfLines={6}
              >
                {post!.text}
              </Text>
            ) : null}
          </View>
        )}
        {!addEmpty ? <View style={styles.actusCardScrim} /> : null}
        {onAvatarPress ? (
          <Pressable
            style={
              addEmpty ? styles.actusCardAvatarSlotAdd : styles.actusCardAvatarSlot
            }
            onPress={(e) => {
              e.stopPropagation();
              onAvatarPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={t("status.add")}
          >
            <View style={styles.actusAvatarWithBadge}>
              <StatusRing colors={colors} variant={ring}>
                <PeerAvatar
                  name={row.displayName}
                  phone={row.peerPhone}
                  remoteUrl={
                    row.avatarUrl ?? demoAvatarUrlForPhone(row.peerPhone)
                  }
                  localUri={contactPhotoUriForPhone(row.peerPhone)}
                  size={addEmpty ? 52 : 48}
                  recyclingKey={row.userId}
                />
              </StatusRing>
              {showAddBadge ? (
                <Pressable
                  style={[
                    styles.actusAddBadge,
                    { backgroundColor: colors.accent },
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    onAddBadgePress?.();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("status.add")}
                >
                  <Text
                    style={styles.actusAddBadgeText}
                    includeFontPadding={false}
                  >
                    +
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        ) : (
          <View
            style={
              addEmpty ? styles.actusCardAvatarSlotAdd : styles.actusCardAvatarSlot
            }
          >
            <View style={styles.actusAvatarWithBadge}>
              <StatusRing colors={colors} variant={ring}>
                <PeerAvatar
                  name={row.displayName}
                  phone={row.peerPhone}
                  remoteUrl={
                    row.avatarUrl ?? demoAvatarUrlForPhone(row.peerPhone)
                  }
                  localUri={contactPhotoUriForPhone(row.peerPhone)}
                  size={addEmpty ? 52 : 48}
                  recyclingKey={row.userId}
                />
              </StatusRing>
              {showAddBadge ? (
                <Pressable
                  style={[
                    styles.actusAddBadge,
                    { backgroundColor: colors.accent },
                  ]}
                  onPress={(e) => {
                    e.stopPropagation();
                    onAddBadgePress?.();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t("status.add")}
                >
                  <Text
                    style={styles.actusAddBadgeText}
                    includeFontPadding={false}
                  >
                    +
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        <Text
          style={[
            styles.actusCardLabel,
            centerLabel ? styles.actusCardLabelPeer : styles.actusCardLabelMine,
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
});

type Props = {
  isActive: boolean;
};

export function ActusPanel({ isActive }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const { token, user } = useAuth();
  const [tick, setTick] = useState(0);

  const myIdFromAuth = useMemo(() => {
    const sub = accessTokenSubject(token);
    if (sub) return sub;
    return String(user?.id ?? "").trim();
  }, [token, user?.id]);

  useEffect(() => subscribeStatusFeed(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    if (!token || !myIdFromAuth) return;
    const name =
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
      t("status.myStatus");
    ensureStatusFeedPlaceholder({
      userId: myIdFromAuth,
      displayName: name,
      peerPhone: user?.phone ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    });
    applyDemoStatusFeedNow(myIdFromAuth, {
      displayName: name,
      peerPhone: user?.phone ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    });
  }, [token, myIdFromAuth, user, t]);

  useEffect(() => {
    if (!token) return;
    if (statusFeedHasPeerPosts()) return;
    void import("@/lib/api/client")
      .then((api) => api.listStatusFeed(token))
      .then((res) => applyStatusFeedSnapshot(res.items, res.myUserId))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!isActive || !token || !myIdFromAuth) return;
    const name =
      [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
      t("status.myStatus");
    applyDemoStatusFeedNow(myIdFromAuth, {
      displayName: name,
      peerPhone: user?.phone ?? null,
      avatarUrl: user?.avatarUrl ?? null,
    });
    syncStatusFeedFromNetwork(token, {
      force: !statusFeedHasPeerPosts(),
    });
  }, [isActive, token, myIdFromAuth, user, t]);

  void tick;
  const myId = getStatusMyUserId() || myIdFromAuth;
  const items = getStatusFeedSnapshot();
  const mine =
    items.find((r) => r.userId === myId) ??
    ({
      userId: myId,
      displayName: t("status.myStatus"),
      peerPhone: user?.phone ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      posts: [],
      hasUnseen: false,
    } satisfies StatusFeedItem);
  const myPosts = activePosts(mine.posts);
  const peers = items
    .filter((r) => r.userId !== myId && activePosts(r.posts).length > 0)
    .sort((a, b) => {
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      const ta = lastActivePost(a)?.createdAt ?? "";
      const tb = lastActivePost(b)?.createdAt ?? "";
      return Date.parse(tb) - Date.parse(ta);
    });

  const openCreateStatus = useCallback(() => {
    router.push("/status/create");
  }, []);

  const openMyStatusList = useCallback(() => {
    if (myPosts.length === 0) {
      openCreateStatus();
      return;
    }
    router.push("/status/mine");
  }, [myPosts.length, openCreateStatus]);

  const confirmDeleteMine = useCallback(() => {
    if (!token || myPosts.length === 0) return;
    Alert.alert(t("status.deleteMineTitle"), t("status.deleteMineMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("status.deleteMineConfirm"),
        style: "destructive",
        onPress: () => {
          void import("@/lib/api/client")
            .then((api) => api.deleteMyStatuses(token))
            .then(() => {
              if (myId) removeMyStatusPosts(myId);
              syncStatusFeedFromNetwork(token, { force: true });
            });
        },
      },
    ]);
  }, [token, myPosts.length, myId, t]);

  const openPeer = (row: StatusFeedItem) => {
    router.push({
      pathname: "/status/view",
      params: {
        userId: row.userId,
        index: String(statusViewStartIndex(row.userId)),
        advanceFeed: "1",
      },
    });
  };

  if (!token) {
    return (
      <View style={styles.actusEmpty}>
        <Text style={{ color: colors.textMuted }}>{t("actus.signInRequired")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.actusPanelRoot}>
      <Text style={styles.actusSectionTitle}>{t("status.sectionTitle")}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actusRow}
      >
        <StatusActusCard
          row={mine}
          ring={
            myPosts.length === 0
              ? "add"
              : mine.hasUnseen
                ? "unseen"
                : "seen"
          }
          label={
            myPosts.length > 0 ? t("status.myStatus") : t("status.addCard")
          }
          onPress={openMyStatusList}
          onLongPress={myPosts.length > 0 ? confirmDeleteMine : undefined}
          isAdd={myPosts.length === 0}
          showAddBadge
          onAddBadgePress={openCreateStatus}
          onAvatarPress={openCreateStatus}
        />
        {peers.map((row) => (
          <StatusActusCard
            key={row.userId}
            row={row}
            ring={row.hasUnseen ? "unseen" : "seen"}
            label={row.displayName.split(/\s+/)[0] ?? row.displayName}
            onPress={() => openPeer(row)}
            centerLabel
          />
        ))}
      </ScrollView>
      {peers.length === 0 && myPosts.length === 0 ? (
        <Text style={styles.actusHint}>{t("status.empty")}</Text>
      ) : null}
    </View>
  );
}
