import { StatusRing } from "@/components/status/StatusRing";
import { createStatusStyles } from "@/components/status/statusStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import type { StatusFeedItem } from "@/lib/api/types";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import {
  activePosts,
  ensureStatusFeedPlaceholder,
  getStatusFeedSnapshot,
  getStatusMyUserId,
  statusViewStartIndex,
  subscribeStatusFeed,
} from "@/lib/status/statusCache";
import { useTheme } from "@/contexts/ThemeContext";
import { deleteMyStatuses } from "@/lib/api/client";
import { removeMyStatusPosts } from "@/lib/status/statusCache";
import { syncStatusFeedFromNetwork } from "@/lib/status/statusSync";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";

export function StatusStrip() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { token, user } = useAuth();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
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
  }, [token, myIdFromAuth, user, t]);

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
  const peers = items.filter(
    (r) => r.userId !== myId && activePosts(r.posts).length > 0,
  );

  const openMine = () => {
    if (!myId) return;
    if (myPosts.length > 0) {
      router.push({
        pathname: "/status/view",
        params: {
          userId: myId,
          index: String(statusViewStartIndex(myId)),
        },
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
  }, [token, myPosts.length, t]);

  const openPeer = (row: StatusFeedItem) => {
    router.push({
      pathname: "/status/view",
      params: {
        userId: row.userId,
        index: String(statusViewStartIndex(row.userId)),
      },
    });
  };

  if (!token) return null;

  return (
    <View style={styles.strip}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stripScroll}
      >
        <Pressable
          style={styles.stripItem}
          onPress={openMine}
          onLongPress={myPosts.length > 0 ? confirmDeleteMine : undefined}
        >
          <StatusRing
            colors={colors}
            variant={
              myPosts.length === 0
                ? "add"
                : mine.hasUnseen
                  ? "unseen"
                  : "seen"
            }
          >
            <PeerAvatar
              name={mine.displayName}
              phone={mine.peerPhone}
              remoteUrl={
                mine.avatarUrl ?? demoAvatarUrlForPhone(mine.peerPhone)
              }
              localUri={contactPhotoUriForPhone(mine.peerPhone)}
              size={56}
            />
          </StatusRing>
          <Text
            style={[styles.stripLabel, styles.stripLabelMine]}
            numberOfLines={1}
          >
            {t("status.myStatus")}
          </Text>
        </Pressable>
        {peers.map((row) => (
          <Pressable
            key={row.userId}
            style={styles.stripItem}
            onPress={() => openPeer(row)}
          >
            <StatusRing
              colors={colors}
              variant={row.hasUnseen ? "unseen" : "seen"}
            >
              <PeerAvatar
                name={row.displayName}
                phone={row.peerPhone}
                remoteUrl={
                  row.avatarUrl ?? demoAvatarUrlForPhone(row.peerPhone)
                }
                localUri={contactPhotoUriForPhone(row.peerPhone)}
                size={56}
                recyclingKey={row.userId}
              />
            </StatusRing>
            <Text style={styles.stripLabel} numberOfLines={1}>
              {row.displayName.split(/\s+/)[0] ?? row.displayName}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
