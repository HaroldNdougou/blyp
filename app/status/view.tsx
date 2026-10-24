import type { StatusMenuAnchor } from "@/components/status/MyStatusRowMenu";
import { MyStatusDeleteConfirmModal } from "@/components/status/MyStatusDeleteConfirmModal";
import { StatusViewersSheet } from "@/components/status/StatusViewersSheet";
import {
  StatusViewerOwnMenu,
  type StatusViewerOwnMenuAction,
} from "@/components/status/StatusViewerOwnMenu";
import {
  StatusViewerPeerMenu,
  type StatusViewerPeerMenuAction,
} from "@/components/status/StatusViewerPeerMenu";
import { createStatusStyles } from "@/components/status/statusStyles";
import { PeerAvatar } from "@/components/peers/PeerAvatar";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ApiError } from "@/lib/api/errors";
import { listStatusPostViewers } from "@/lib/api/client";
import type { StatusFeedItem, StatusPost, StatusPostViewer } from "@/lib/api/types";
import { demoAvatarUrlForPhone } from "@/lib/dev/demoProfiles";
import { contactPhotoUriForPhone } from "@/lib/contacts/contactPhotos";
import { useStatusPublishedWhen } from "@/hooks/useStatusPublishedWhen";
import { formatCameroonPhoneDisplay } from "@/lib/format";
import { openConversationWithPhone } from "@/lib/messages/openConversationWithPhone";
import { STATUS_SLIDE_MS } from "@/lib/status/constants";
import { resolveStatusTextAppearance } from "@/lib/status/textStatusPalette";
import { deleteMyStatusPostOnServer } from "@/lib/status/deleteStatusPostClient";
import { forwardStatusPost } from "@/lib/status/statusPostActions";
import {
  findStatusFeedItem,
  getStatusMyUserId,
  postsInViewerOrder,
  statusViewStartIndex,
  subscribeStatusFeed,
} from "@/lib/status/statusCache";
import { consumePendingEditViewerPostId } from "@/lib/status/statusEditReturn";
import { statusPostDisplayWhenIso } from "@/lib/status/statusPostOrder";
import { nextStatusViewerUserId } from "@/lib/status/statusViewerQueue";
import { confirmStatusView, syncStatusFeedFromNetwork } from "@/lib/status/statusSync";
import { Ionicons } from "@expo/vector-icons";
import { useIsFocused } from "@react-navigation/native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

export default function StatusViewScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();
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
  const slideTimerRef = useRef({
    startedAt: 0,
    accumulatedPauseMs: 0,
    isPaused: false,
    pauseStartedAt: 0,
  });
  const slidePressInAtRef = useRef(0);
  const peerMenuBtnRef = useRef<View>(null);
  const [peerMenuOpen, setPeerMenuOpen] = useState(false);
  const [peerMenuAnchor, setPeerMenuAnchor] = useState<StatusMenuAnchor | null>(
    null,
  );
  const ownMenuBtnRef = useRef<View>(null);
  const [ownMenuOpen, setOwnMenuOpen] = useState(false);
  const [ownMenuAnchor, setOwnMenuAnchor] = useState<StatusMenuAnchor | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<StatusPost | null>(null);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewersLoading, setViewersLoading] = useState(false);
  const [viewers, setViewers] = useState<StatusPostViewer[]>([]);
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
  const isFocused = useIsFocused();
  const row = findStatusFeedItem(activeUserId);
  const posts = row ? postsInViewerOrder(row.posts) : [];
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
  const publishedWhen = useStatusPublishedWhen(
    post ? statusPostDisplayWhenIso(post) : "",
  );
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

  const pauseSlideProgress = useCallback(() => {
    const s = slideTimerRef.current;
    if (s.isPaused) return;
    s.isPaused = true;
    s.pauseStartedAt = Date.now();
  }, []);

  const resumeSlideProgress = useCallback(() => {
    const s = slideTimerRef.current;
    if (!s.isPaused) return;
    s.accumulatedPauseMs += Date.now() - s.pauseStartedAt;
    s.isPaused = false;
  }, []);

  const onViewerPressIn = useCallback(() => {
    slidePressInAtRef.current = Date.now();
    pauseSlideProgress();
  }, [pauseSlideProgress]);

  const onViewerPressOut = useCallback(() => {
    resumeSlideProgress();
  }, [resumeSlideProgress]);

  const onViewerPress = useCallback(
    (locationX: number) => {
      const heldMs = Date.now() - slidePressInAtRef.current;
      if (heldMs > 220) return;
      if (locationX < width * 0.35) goPrev();
      else goNext();
    },
    [width, goPrev, goNext],
  );

  useEffect(() => {
    if (
      !isFocused ||
      peerMenuOpen ||
      ownMenuOpen ||
      deleteTarget ||
      viewersOpen
    ) {
      pauseSlideProgress();
    } else {
      resumeSlideProgress();
    }
  }, [
    isFocused,
    peerMenuOpen,
    ownMenuOpen,
    deleteTarget,
    viewersOpen,
    pauseSlideProgress,
    resumeSlideProgress,
  ]);

  useEffect(() => {
    setViewersOpen(false);
    setViewers([]);
  }, [post?.id]);

  const openViewersSheet = useCallback(() => {
    if (!token || !post?.id) return;
    setViewersOpen(true);
    setViewersLoading(true);
    void listStatusPostViewers(token, post.id)
      .then((res) => setViewers(res.viewers ?? []))
      .catch(() => setViewers([]))
      .finally(() => setViewersLoading(false));
  }, [token, post?.id]);

  useFocusEffect(
    useCallback(() => {
      const bumpedId = consumePendingEditViewerPostId();
      if (!bumpedId || !row) return;
      const ordered = postsInViewerOrder(row.posts);
      const idx = ordered.findIndex((p) => p.id === bumpedId);
      if (idx >= 0) {
        setIndex(idx);
        setSlideProgress(0);
        slideTimerRef.current = {
          startedAt: Date.now(),
          accumulatedPauseMs: 0,
          isPaused: false,
          pauseStartedAt: 0,
        };
      }
    }, [row]),
  );

  const openPeerMenu = useCallback(() => {
    peerMenuBtnRef.current?.measureInWindow((x, y, width, height) => {
      setPeerMenuAnchor({ x, y, width, height });
      setPeerMenuOpen(true);
    });
  }, []);

  const openOwnMenu = useCallback(() => {
    ownMenuBtnRef.current?.measureInWindow((x, y, width, height) => {
      setOwnMenuAnchor({ x, y, width, height });
      setOwnMenuOpen(true);
    });
  }, []);

  const onOwnMenuAction = useCallback(
    (action: StatusViewerOwnMenuAction) => {
      if (!post || !myId) return;
      if (action === "forward") {
        const ok = forwardStatusPost(post, myId);
        if (!ok) Alert.alert(t("status.forwardUnavailable"));
        return;
      }
      if (action === "edit") {
        router.push(`/status/edit/${encodeURIComponent(post.id)}`);
        return;
      }
      if (action === "delete") {
        setDeleteTarget(post);
      }
    },
    [post, myId, t],
  );

  const confirmDeleteOne = useCallback(() => {
    const target = deleteTarget;
    if (!target || !token || !myId) return;
    setDeleteTarget(null);
    void deleteMyStatusPostOnServer(token, myId, target.id)
      .then(() => {
        const remaining = postsInViewerOrder(
          findStatusFeedItem(myId)?.posts ?? [],
        ).filter((p) => p.id !== target.id);
        if (remaining.length === 0) closeViewer();
      })
      .catch((e) => {
        const msg =
          e instanceof ApiError && e.message
            ? e.message
            : t("common.genericError");
        Alert.alert(t("status.deleteOneTitle"), msg);
      });
  }, [deleteTarget, token, myId, t, closeViewer]);

  const peerPhoneE164 = useMemo(() => {
    const raw = String(viewRow?.peerPhone ?? "").trim();
    return raw.length > 0 ? raw : null;
  }, [viewRow?.peerPhone]);

  const onPeerMenuAction = useCallback(
    (action: StatusViewerPeerMenuAction) => {
      if (!viewRow) return;
      const showComingSoon = () => {
        Alert.alert(t("status.comingSoonTitle"), t("status.comingSoonMessage"));
      };
      if (action === "message") {
        if (!peerPhoneE164) {
          Alert.alert(
            t("status.viewerContactTitle"),
            t("status.viewerContactNoPhone"),
          );
          return;
        }
        void openConversationWithPhone(peerPhoneE164).then((res) => {
          if (res.ok) return;
          if (res.code === "session") {
            Alert.alert(t("messages.sessionExpired"));
            return;
          }
          Alert.alert(
            t("messages.openFailed"),
            res.message ?? t("common.genericError"),
          );
        });
        return;
      }
      if (action === "voiceCall") {
        if (!peerPhoneE164) {
          Alert.alert(
            t("status.viewerContactTitle"),
            t("status.viewerContactNoPhone"),
          );
          return;
        }
        const tel = peerPhoneE164.replace(/\s/g, "");
        void Linking.openURL(`tel:${tel}`).catch(() => {
          Alert.alert(
            t("status.viewerMenuVoiceCall"),
            t("status.viewerCallUnavailable"),
          );
        });
        return;
      }
      if (action === "viewContact") {
        const name = viewRow.displayName?.trim() || t("status.viewerContactTitle");
        if (!peerPhoneE164) {
          Alert.alert(name, t("status.viewerContactNoPhone"));
          return;
        }
        const digits = peerPhoneE164.replace(/\D/g, "").slice(-9);
        const phoneLine = formatCameroonPhoneDisplay(digits) || peerPhoneE164;
        Alert.alert(name, phoneLine);
        return;
      }
      if (
        action === "videoCall" ||
        action === "notifications" ||
        action === "mute" ||
        action === "report"
      ) {
        showComingSoon();
      }
    },
    [viewRow, peerPhoneE164, t],
  );

  useEffect(() => {
    if (!post) return;
    const shouldPause =
      !isFocused ||
      peerMenuOpen ||
      ownMenuOpen ||
      Boolean(deleteTarget) ||
      viewersOpen;
    slideTimerRef.current = {
      startedAt: Date.now(),
      accumulatedPauseMs: 0,
      isPaused: shouldPause,
      pauseStartedAt: shouldPause ? Date.now() : 0,
    };
    setSlideProgress(0);
    const tick = setInterval(() => {
      const s = slideTimerRef.current;
      if (s.isPaused) return;
      const elapsed = Date.now() - s.startedAt - s.accumulatedPauseMs;
      const p = Math.min(1, elapsed / STATUS_SLIDE_MS);
      setSlideProgress(p);
      if (p >= 1) goNextRef.current();
    }, 40);
    return () => clearInterval(tick);
  }, [
    post?.id,
    isFocused,
    peerMenuOpen,
    ownMenuOpen,
    deleteTarget,
    viewersOpen,
  ]);

  const mineViewCount = Math.max(0, Math.floor(post?.viewCount ?? 0));
  const mineFooterBottom = Math.max(insets.bottom, 12) + 8;

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
          <Pressable
            onPress={closeViewer}
            style={styles.viewerHeaderIconBtn}
            accessibilityLabel={t("common.back")}
            hitSlop={8}
          >
            <Ionicons
              name="chevron-back"
              size={28}
              color={colors.textInverse}
            />
          </Pressable>
          {isMine ? (
            <Pressable
              onPress={() => router.push("/status/create")}
              accessibilityLabel={t("status.add")}
              hitSlop={4}
            >
              <View style={styles.viewerAvatarWrap}>
                <PeerAvatar
                  name={viewRow.displayName}
                  phone={viewRow.peerPhone ?? user?.phone}
                  remoteUrl={
                    viewRow.avatarUrl ??
                    user?.avatarUrl ??
                    demoAvatarUrlForPhone(viewRow.peerPhone)
                  }
                  localUri={contactPhotoUriForPhone(
                    viewRow.peerPhone ?? user?.phone,
                  )}
                  size={40}
                />
                <View style={styles.viewerAvatarAddBadge}>
                  <Ionicons
                    name="add"
                    size={14}
                    color={colors.statusAddBadgePlus}
                  />
                </View>
              </View>
            </Pressable>
          ) : (
            <PeerAvatar
              name={viewRow.displayName}
              phone={viewRow.peerPhone}
              remoteUrl={
                viewRow.avatarUrl ?? demoAvatarUrlForPhone(viewRow.peerPhone)
              }
              localUri={contactPhotoUriForPhone(viewRow.peerPhone)}
              size={40}
            />
          )}
          <View style={styles.viewerHeaderMeta}>
            <Text style={styles.viewerName} numberOfLines={1}>
              {isMine ? t("status.myStatus") : viewRow.displayName}
            </Text>
            {publishedWhen || post.editedAt ? (
              <View style={styles.viewerPublishedRow}>
                {post.editedAt ? (
                  <Text style={styles.viewerEditedLabel} numberOfLines={1}>
                    {t("status.editedLabel")}
                  </Text>
                ) : null}
                {publishedWhen ? (
                  <Text style={styles.viewerPublishedAt} numberOfLines={1}>
                    {publishedWhen}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {isMine ? (
            <View ref={ownMenuBtnRef} collapsable={false}>
              <Pressable
                onPress={openOwnMenu}
                style={styles.viewerHeaderIconBtn}
                accessibilityLabel={t("status.viewerMenuA11y")}
                hitSlop={8}
              >
                <Ionicons
                  name="ellipsis-vertical"
                  size={22}
                  color={colors.textInverse}
                />
              </Pressable>
            </View>
          ) : (
            <View ref={peerMenuBtnRef} collapsable={false}>
              <Pressable
                onPress={openPeerMenu}
                style={styles.viewerHeaderIconBtn}
                accessibilityLabel={t("status.viewerMenuA11y")}
                hitSlop={8}
              >
                <Ionicons
                  name="ellipsis-vertical"
                  size={22}
                  color={colors.textInverse}
                />
              </Pressable>
            </View>
          )}
        </View>
        {!isMine ? (
          <StatusViewerPeerMenu
            visible={peerMenuOpen}
            anchor={peerMenuAnchor}
            onDismiss={() => setPeerMenuOpen(false)}
            onAction={onPeerMenuAction}
          />
        ) : (
          <StatusViewerOwnMenu
            visible={ownMenuOpen}
            anchor={ownMenuAnchor}
            onDismiss={() => setOwnMenuOpen(false)}
            onAction={onOwnMenuAction}
          />
        )}
        {isMine ? (
          <>
            <MyStatusDeleteConfirmModal
              visible={deleteTarget != null}
              onCancel={() => setDeleteTarget(null)}
              onConfirm={confirmDeleteOne}
            />
            <StatusViewersSheet
              visible={viewersOpen}
              loading={viewersLoading}
              viewers={viewers}
              onDismiss={() => setViewersOpen(false)}
            />
          </>
        ) : null}
        <Pressable
          style={{ flex: 1 }}
          onPressIn={onViewerPressIn}
          onPressOut={onViewerPressOut}
          onPress={(e) => onViewerPress(e.nativeEvent.locationX)}
        >
          {post.kind === "image" && post.mediaUrl ? (
            <Image
              source={{ uri: post.mediaUrl }}
              style={styles.viewerMedia}
              contentFit="contain"
            />
          ) : (
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
          )}
        </Pressable>
        {post.text && post.kind === "image" ? (
          <Text style={styles.viewerCaption}>{post.text}</Text>
        ) : null}
        {isMine ? (
          <View
            style={[styles.viewerMineFooter, { bottom: mineFooterBottom }]}
            pointerEvents="box-none"
          >
            <Pressable
              style={styles.viewerMineViewsPill}
              onPress={openViewersSheet}
              accessibilityRole="button"
              accessibilityLabel={t("status.viewersOpenA11y")}
            >
              <Text style={styles.viewerMineViewsText}>
                {t("status.viewCount", { count: mineViewCount })}
              </Text>
            </Pressable>
          </View>
        ) : null}
    </SafeAreaView>
  );
}
