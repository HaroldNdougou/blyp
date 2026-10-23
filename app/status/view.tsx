import { createStatusStyles } from "@/components/status/statusStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { deleteMyStatuses } from "@/lib/api/client";
import type { StatusFeedItem, StatusPost } from "@/lib/api/types";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import { formatStatusPublishedWhen } from "@/lib/format";
import { STATUS_SLIDE_MS } from "@/lib/status/constants";
import { resolveStatusTextAppearance } from "@/lib/status/textStatusPalette";
import {
  activePosts,
  findStatusFeedItem,
  getStatusMyUserId,
  removeMyStatusPosts,
  statusViewStartIndex,
  subscribeStatusFeed,
} from "@/lib/status/statusCache";
import { nextStatusViewerUserId } from "@/lib/status/statusViewerQueue";
import { confirmStatusView, syncStatusFeedFromNetwork } from "@/lib/status/statusSync";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Pressable,
  StyleSheet,
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
  const params = useLocalSearchParams<{
    userId?: string;
    index?: string;
    advanceFeed?: string;
  }>();
  const entryUserId = decodeURIComponent(String(params.userId ?? ""));
  const advanceFeed = params.advanceFeed === "1";
  const startIndex = Math.max(0, parseInt(String(params.index ?? "0"), 10) || 0);
  const [feedTick, setFeedTick] = useState(0);
  const [activeUserId, setActiveUserId] = useState(entryUserId);
  const [index, setIndex] = useState(startIndex);
  const [slideProgress, setSlideProgress] = useState(0);
  const { width } = useWindowDimensions();

  const closingRef = useRef(false);
  const viewerSnapshotRef = useRef<{
    row: StatusFeedItem;
    posts: StatusPost[];
    index: number;
  } | null>(null);
  const goNextRef = useRef<() => void>(() => {});

  const closeViewer = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    router.back();
  }, []);

  void feedTick;
  const row = findStatusFeedItem(activeUserId);
  const posts = row ? activePosts(row.posts) : [];
  const safeIndex = Math.min(index, Math.max(0, posts.length - 1));
  const livePost = posts[safeIndex];
  if (row && livePost && posts.length > 0) {
    viewerSnapshotRef.current = { row, posts, index: safeIndex };
  }
  const snap = viewerSnapshotRef.current;
  const viewRow = row && livePost ? row : snap?.row;
  const viewPosts = row && livePost ? posts : snap?.posts ?? [];
  const viewIndex = row && livePost ? safeIndex : snap?.index ?? 0;
  const post =
    viewPosts[Math.min(viewIndex, Math.max(0, viewPosts.length - 1))];
  const textAppearance =
    post?.kind === "text"
      ? resolveStatusTextAppearance(post.textStyle)
      : null;
  const viewerBg =
    textAppearance?.backgroundColor ?? colors.statusViewerBackground;
  const myId = getStatusMyUserId();
  const isMine = activeUserId === myId;

  useEffect(
    () =>
      subscribeStatusFeed(() => {
        if (closingRef.current) return;
        setFeedTick((n) => n + 1);
      }),
    [],
  );

  useEffect(() => {
    if (!token) return;
    syncStatusFeedFromNetwork(token, { force: true });
  }, [token]);

  useEffect(() => {
    setActiveUserId(entryUserId);
    setIndex(startIndex);
  }, [entryUserId, startIndex]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, posts.length - 1)));
  }, [activeUserId, posts.length]);

  useEffect(() => {
    if (!token || !post?.id) return;
    confirmStatusView(token, post.id);
  }, [token, post?.id]);

  const goNext = useCallback(() => {
    if (safeIndex < posts.length - 1) {
      setIndex((i) => i + 1);
      return;
    }
    if (advanceFeed && entryUserId !== myId) {
      const nextUserId = nextStatusViewerUserId(entryUserId, activeUserId);
      if (nextUserId) {
        setActiveUserId(nextUserId);
        setIndex(statusViewStartIndex(nextUserId));
        return;
      }
    }
    closeViewer();
  }, [
    safeIndex,
    posts.length,
    advanceFeed,
    entryUserId,
    activeUserId,
    myId,
    closeViewer,
  ]);

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
            closeViewer();
          });
        },
      },
    ]);
  }, [token, isMine, myId, t, closeViewer]);

  if (!viewRow || !post) {
    return (
      <SafeAreaView
        style={[
          styles.viewerRoot,
          { backgroundColor: colors.statusViewerBackground },
        ]}
      >
        <StatusBar style="light" />
        <Pressable onPress={closeViewer} style={{ padding: 16 }}>
          <Text style={{ color: colors.textInverse }}>{t("common.back")}</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const progressIndex = row && livePost ? safeIndex : viewIndex;
  const publishedWhen = formatStatusPublishedWhen(post.createdAt);

  return (
    <SafeAreaView style={[styles.viewerRoot, { backgroundColor: viewerBg }]}>
      <StatusBar style="light" />
        <View style={styles.progressRow}>
          {viewPosts.map((p, i) => {
            const fill =
              i < progressIndex ? 1 : i === progressIndex ? slideProgress : 0;
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
            name={viewRow.displayName}
            phone={viewRow.peerPhone}
            remoteUrl={
              viewRow.avatarUrl ?? demoAvatarUrlForPhone(viewRow.peerPhone)
            }
            localUri={contactPhotoUriForPhone(viewRow.peerPhone)}
            size={40}
          />
          <View style={styles.viewerHeaderMeta}>
            <Text style={styles.viewerName} numberOfLines={1}>
              {viewRow.displayName}
            </Text>
            {publishedWhen ? (
              <Text style={styles.viewerPublishedAt} numberOfLines={1}>
                {publishedWhen}
              </Text>
            ) : null}
          </View>
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
            onPress={closeViewer}
            accessibilityLabel={t("common.close")}
          >
            <Text style={{ color: colors.textInverse, fontSize: 22 }}>×</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>
          {post.kind === "image" && post.mediaUrl ? (
            <View style={{ flex: 1, flexDirection: "row" }}>
              <Pressable
                style={{ width: width * 0.35, flex: 0 }}
                onPress={goPrev}
              />
              <Pressable style={{ flex: 1 }} onPress={goNext}>
                <Image
                  source={{ uri: post.mediaUrl }}
                  style={styles.viewerMedia}
                  contentFit="contain"
                />
              </Pressable>
            </View>
          ) : (
            <>
              <View
                style={[
                  StyleSheet.absoluteFill,
                  styles.viewerTextOnly,
                  textAppearance && {
                    backgroundColor: textAppearance.backgroundColor,
                  },
                ]}
                pointerEvents="none"
              >
                <Text
                  style={[
                    styles.viewerTextOnlyLabel,
                    textAppearance && {
                      fontSize: textAppearance.font.fontSize,
                      fontWeight: textAppearance.font.fontWeight,
                      fontStyle: textAppearance.font.fontStyle ?? "normal",
                      fontFamily: textAppearance.font.fontFamily,
                    },
                  ]}
                >
                  {post.text}
                </Text>
              </View>
              <View style={[StyleSheet.absoluteFill, { flexDirection: "row" }]}>
                <Pressable style={{ flex: 1 }} onPress={goPrev} />
                <Pressable style={{ flex: 1 }} onPress={goNext} />
              </View>
            </>
          )}
        </View>
        {post.text && post.kind === "image" ? (
          <Text style={styles.viewerCaption}>{post.text}</Text>
        ) : null}
    </SafeAreaView>
  );
}
