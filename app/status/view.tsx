import { createStatusStyles } from "@/components/status/statusStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { deleteMyStatuses } from "@/lib/api/client";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import { STATUS_SLIDE_MS } from "@/lib/status/constants";
import {
  activePosts,
  findStatusFeedItem,
  getStatusMyUserId,
  removeMyStatusPosts,
  subscribeStatusFeed,
} from "@/lib/status/statusCache";
import { confirmStatusView, syncStatusFeedFromNetwork } from "@/lib/status/statusSync";
import { modalPresentation } from "@/lib/perf/instantMotion";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function StatusViewScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const { token } = useAuth();
  const params = useLocalSearchParams<{ userId?: string; index?: string }>();
  const userId = decodeURIComponent(String(params.userId ?? ""));
  const startIndex = Math.max(0, parseInt(String(params.index ?? "0"), 10) || 0);
  const [feedTick, setFeedTick] = useState(0);
  const [index, setIndex] = useState(startIndex);
  const [slideProgress, setSlideProgress] = useState(0);
  const { width } = useWindowDimensions();

  void feedTick;
  const row = findStatusFeedItem(userId);
  const posts = row ? activePosts(row.posts) : [];
  const safeIndex = Math.min(index, Math.max(0, posts.length - 1));
  const post = posts[safeIndex];
  const myId = getStatusMyUserId();
  const isMine = userId === myId;
  const goNextRef = useRef<() => void>(() => {});

  useEffect(() => subscribeStatusFeed(() => setFeedTick((n) => n + 1)), []);

  useEffect(() => {
    if (!token) return;
    syncStatusFeedFromNetwork(token, { force: true });
  }, [token]);

  useEffect(() => {
    setIndex(Math.min(startIndex, Math.max(0, posts.length - 1)));
  }, [userId, startIndex, posts.length]);

  useEffect(() => {
    if (!token || !post?.id) return;
    confirmStatusView(token, post.id);
  }, [token, post?.id]);

  const goNext = useCallback(() => {
    if (safeIndex < posts.length - 1) setIndex((i) => i + 1);
    else router.back();
  }, [safeIndex, posts.length]);

  const goPrev = useCallback(() => {
    if (safeIndex > 0) setIndex((i) => i - 1);
  }, [safeIndex]);

  goNextRef.current = goNext;

  useEffect(() => {
    if (!post) return;
    setSlideProgress(0);
    const started = Date.now();
    const tick = setInterval(() => {
      const p = Math.min(1, (Date.now() - started) / STATUS_SLIDE_MS);
      setSlideProgress(p);
      if (p >= 1) goNextRef.current();
    }, 40);
    return () => clearInterval(tick);
  }, [post?.id]);

  const confirmDeleteMine = useCallback(() => {
    if (!token || !isMine) return;
    Alert.alert(t("status.deleteMineTitle"), t("status.deleteMineMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("status.deleteMineConfirm"),
        style: "destructive",
        onPress: () => {
          void deleteMyStatuses(token).then(() => {
            if (myId) removeMyStatusPosts(myId);
            syncStatusFeedFromNetwork(token, { force: true });
            router.back();
          });
        },
      },
    ]);
  }, [token, isMine, myId, t]);

  if (!row || !post) {
    return (
      <SafeAreaView style={styles.viewerRoot}>
        <Pressable onPress={() => router.back()} style={{ padding: 16 }}>
          <Text style={{ color: colors.text }}>{t("common.back")}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <Modal
      visible
      animationType={modalPresentation}
      onRequestClose={() => router.back()}
    >
      <SafeAreaView
        style={[
          styles.viewerRoot,
          { backgroundColor: colors.statusViewerBackground },
        ]}
      >
        <View style={styles.progressRow}>
          {posts.map((p, i) => {
            const fill =
              i < safeIndex ? 1 : i === safeIndex ? slideProgress : 0;
            return (
              <View key={p.id} style={styles.progressSeg}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${fill * 100}%` },
                  ]}
                />
              </View>
            );
          })}
        </View>
        <View style={styles.viewerHeader}>
          <PeerAvatar
            name={row.displayName}
            phone={row.peerPhone}
            remoteUrl={row.avatarUrl ?? demoAvatarUrlForPhone(row.peerPhone)}
            localUri={contactPhotoUriForPhone(row.peerPhone)}
            size={36}
          />
          <Text style={[styles.viewerName, { color: colors.textInverse }]}>
            {row.displayName}
          </Text>
          {isMine ? (
            <Pressable
              onPress={() => router.push("/status/create")}
              accessibilityLabel={t("status.add")}
            >
              <Text style={{ color: colors.accent, fontWeight: "700", fontSize: 22 }}>
                +
              </Text>
            </Pressable>
          ) : null}
          {isMine ? (
            <Pressable
              onPress={confirmDeleteMine}
              accessibilityLabel={t("status.deleteMineConfirm")}
            >
              <Text style={{ color: colors.textInverse, fontSize: 18 }}>
                …
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel={t("common.close")}
          >
            <Text style={{ color: colors.textInverse, fontSize: 22 }}>×</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <Pressable style={{ width: width * 0.35, flex: 0 }} onPress={goPrev} />
          <Pressable style={{ flex: 1 }} onPress={goNext}>
            {post.kind === "image" && post.mediaUrl ? (
              <Image
                source={{ uri: post.mediaUrl }}
                style={styles.viewerMedia}
                contentFit="contain"
              />
            ) : (
              <View style={styles.viewerTextOnly}>
                <Text style={styles.viewerTextOnlyLabel}>{post.text}</Text>
              </View>
            )}
          </Pressable>
        </View>
        {post.text && post.kind === "image" ? (
          <Text style={styles.viewerCaption}>{post.text}</Text>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}
