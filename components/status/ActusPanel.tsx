import { StatusRing } from "@/components/status/StatusRing";
import { createStatusStyles } from "@/components/status/statusStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { StatusFeedItem, StatusPost } from "@/lib/api/types";
import { deleteMyStatuses, listStatusFeed } from "@/lib/api/client";
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
};

const StatusActusCard = React.memo(function StatusActusCard({
  row,
  ring,
  label,
  onPress,
  onLongPress,
  isAdd,
}: StatusCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const post = lastActivePost(row);
  const previewUri =
    post?.kind === "image" && post.mediaUrl ? post.mediaUrl : null;
  const showTextPreview = !previewUri && !!post?.text;
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
                  : colors.accentDark,
                alignItems: "center",
                justifyContent: "center",
                padding: 8,
              },
            ]}
          >
            {showTextPreview ? (
              <Text style={styles.actusCardTextPreview} numberOfLines={6}>
                {post!.text}
              </Text>
            ) : null}
          </View>
        )}
        {!addEmpty ? <View style={styles.actusCardScrim} /> : null}
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
            {isAdd ? (
              <View
                style={[
                  styles.actusAddBadge,
                  { backgroundColor: colors.accent },
                ]}
              >
                <Text style={styles.actusAddBadgeText} includeFontPadding={false}>
                  +
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Text
          style={[
            styles.actusCardLabel,
            !isAdd && styles.actusCardLabelPeer,
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
    void listStatusFeed(token)
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

  const openMine = () => {
    if (!myId) return;
    if (myPosts.length > 0) {
      router.push({
        pathname: "/status/view",
        params: { userId: myId, index: "0" },
      });
    } else {
      router.push("/status/create");
    }
  };

  const confirmDeleteMine = useCallback(() => {
    if (!token || myPosts.length === 0) return;
    Alert.alert(t("status.deleteMineTitle"), t("status.deleteMineMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("status.deleteMineConfirm"),
        style: "destructive",
        onPress: () => {
          void deleteMyStatuses(token).then(() => {
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
      params: { userId: row.userId, index: "0" },
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
          label={t("status.addCard")}
          onPress={openMine}
          onLongPress={myPosts.length > 0 ? confirmDeleteMine : undefined}
          isAdd
        />
        {peers.map((row) => (
          <StatusActusCard
            key={row.userId}
            row={row}
            ring={row.hasUnseen ? "unseen" : "seen"}
            label={row.displayName.split(/\s+/)[0] ?? row.displayName}
            onPress={() => openPeer(row)}
          />
        ))}
      </ScrollView>
      {peers.length === 0 && myPosts.length === 0 ? (
        <Text style={styles.actusHint}>{t("status.empty")}</Text>
      ) : null}
    </View>
  );
}
