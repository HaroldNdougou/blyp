import { createStatusStyles } from "@/components/status/statusStyles";
import { resolveStatusTextAppearance } from "@/lib/status/textStatusPalette";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { StatusPost } from "@/lib/api/types";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import { useStatusPublishedWhen } from "@/hooks/useStatusPublishedWhen";
import { ApiError } from "@/lib/api/errors";
import { deleteMyStatusPostOnServer } from "@/lib/status/deleteStatusPostClient";
import { MyStatusDeleteConfirmModal } from "@/components/status/MyStatusDeleteConfirmModal";
import {
  MyStatusRowMenu,
  type StatusMenuAnchor,
} from "@/components/status/MyStatusRowMenu";
import {
  forwardStatusPost,
  shareStatusPost,
} from "@/lib/status/statusPostActions";
import {
  findStatusFeedItem,
  getStatusMyUserId,
  postsInViewerOrder,
  subscribeStatusFeed,
} from "@/lib/status/statusCache";
import {
  statusPostDisplayWhenIso,
  statusPostSortMs,
} from "@/lib/status/statusPostOrder";
import { syncStatusFeedFromNetwork } from "@/lib/status/statusSync";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

function postIndexInViewerOrder(posts: StatusPost[], postId: string): number {
  const ordered = postsInViewerOrder(posts);
  const i = ordered.findIndex((p) => p.id === postId);
  return i >= 0 ? i : 0;
}

type RowProps = {
  post: StatusPost;
  styles: ReturnType<typeof createStatusStyles>; // eslint-disable-line @typescript-eslint/no-redundant-type-constituents
  colors: ThemeColors;
  onOpen: () => void;
  onOpenMenu: (post: StatusPost, anchor: StatusMenuAnchor) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

function MyStatusListRow({
  post,
  styles,
  colors,
  onOpen,
  onOpenMenu,
  t,
}: RowProps) {
  const menuRef = useRef<View>(null);
  const when = useStatusPublishedWhen(statusPostDisplayWhenIso(post));
  const views = Math.max(0, Math.floor(post.viewCount ?? 0));
  const previewUri =
    post.kind === "image" && post.mediaUrl ? post.mediaUrl : null;
  const textLook =
    post.kind === "text" ? resolveStatusTextAppearance(post.textStyle) : null;

  return (
    <Pressable
      style={styles.myStatusRow}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t("status.myStatusRowA11y", { when, count: views })}
    >
      <View style={styles.myStatusThumbWrap}>
        {previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={styles.myStatusThumb}
            contentFit="cover"
          />
        ) : (
          <View
            style={[
              styles.myStatusThumb,
              {
                backgroundColor:
                  textLook?.backgroundColor ?? colors.accentDark,
                alignItems: "center",
                justifyContent: "center",
                padding: 8,
              },
            ]}
          >
            {post.text ? (
              <Text
                style={[
                  styles.actusCardTextPreview,
                  textLook && {
                    fontSize: Math.round(textLook.font.fontSize * 0.22),
                    fontWeight: textLook.font.fontWeight,
                    fontStyle: textLook.font.fontStyle ?? "normal",
                  },
                ]}
                numberOfLines={3}
              >
                {post.text}
              </Text>
            ) : null}
          </View>
        )}
      </View>
      <View style={styles.myStatusRowMeta}>
        <Text style={styles.myStatusRowViews} numberOfLines={1}>
          {t("status.viewCount", { count: views })}
        </Text>
        <Text style={styles.myStatusRowWhen} numberOfLines={1}>
          {when}
        </Text>
      </View>
      <View ref={menuRef} collapsable={false}>
        <Pressable
          style={styles.myStatusRowMenuBtn}
          onPress={(e) => {
            e.stopPropagation();
            menuRef.current?.measureInWindow((x, y, width, height) => {
              onOpenMenu(post, { x, y, width, height });
            });
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("status.rowMenuA11y")}
        >
          <Ionicons
            name="ellipsis-vertical"
            size={20}
            color={colors.textMuted}
          />
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function MyStatusListScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { token, user } = useAuth();
  const [tick, setTick] = useState(0);
  const [menuPost, setMenuPost] = useState<StatusPost | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<StatusMenuAnchor | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StatusPost | null>(null);

  const myIdFromAuth = useMemo(() => {
    const sub = accessTokenSubject(token);
    if (sub) return sub;
    return String(user?.id ?? "").trim();
  }, [token, user?.id]);

  useEffect(() => subscribeStatusFeed(() => setTick((n) => n + 1)), []);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      syncStatusFeedFromNetwork(token, { force: false });
    }, [token]),
  );

  void tick;
  const myId = getStatusMyUserId() || myIdFromAuth;
  const row = myId ? findStatusFeedItem(myId) : undefined;
  const postsChrono = postsInViewerOrder(row?.posts ?? []);
  const postsNewestFirst = useMemo(
    () =>
      [...postsChrono].sort(
        (a, b) => statusPostSortMs(b) - statusPostSortMs(a),
      ),
    [postsChrono],
  );

  const openCreatePhoto = useCallback(() => {
    router.push("/status/create");
  }, []);

  const openCreateText = useCallback(() => {
    router.push({ pathname: "/status/create", params: { mode: "text" } });
  }, []);

  const openPost = useCallback(
    (postId: string) => {
      if (!myId) return;
      router.push({
        pathname: "/status/view",
        params: {
          userId: myId,
          index: String(postIndexInViewerOrder(postsChrono, postId)),
        },
      });
    },
    [myId, postsChrono],
  );

  const onArchivePress = useCallback(() => {
    Alert.alert(
      t("status.comingSoonTitle"),
      t("status.archiveComingSoonMessage"),
    );
  }, [t]);

  const closeMenu = useCallback(() => {
    setMenuPost(null);
    setMenuAnchor(null);
  }, []);

  const onOpenMenu = useCallback((post: StatusPost, anchor: StatusMenuAnchor) => {
    setMenuPost(post);
    setMenuAnchor(anchor);
  }, []);

  const onMenuForward = useCallback(
    (post: StatusPost) => {
      if (!myId) return;
      const ok = forwardStatusPost(post, myId);
      if (!ok) Alert.alert(t("status.forwardUnavailable"));
    },
    [myId, t],
  );

  const onMenuEdit = useCallback((post: StatusPost) => {
    router.push(`/status/edit/${encodeURIComponent(post.id)}`);
  }, []);

  const onMenuShare = useCallback((post: StatusPost) => {
    void shareStatusPost(post).catch(() => {
      Alert.alert(t("status.shareUnavailable"));
    });
  }, [t]);

  const onMenuDelete = useCallback((post: StatusPost) => {
    setDeleteTarget(post);
  }, []);

  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  const confirmDelete = useCallback(() => {
    const post = deleteTarget;
    if (!post || !token || !myId) return;
    setDeleteTarget(null);
    void deleteMyStatusPostOnServer(token, myId, post.id).catch((e) => {
      const msg =
        e instanceof ApiError && e.message
          ? e.message
          : t("common.genericError");
      Alert.alert(t("status.deleteOneTitle"), msg);
    });
  }, [deleteTarget, token, myId, t]);

  const fabBottom = Math.max(insets.bottom, 12) + 8;

  return (
    <SafeAreaView style={styles.actusRoot} edges={["top", "left", "right"]}>
      <View style={styles.actusTopBar}>
        <Pressable
          style={styles.actusBackBtn}
          onPress={() => router.back()}
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.actusTitle}>{t("status.myStatusListTitle")}</Text>
        <View style={styles.actusBackBtn} />
      </View>

      <ScrollView
        contentContainerStyle={styles.myStatusListContent}
        showsVerticalScrollIndicator={false}
      >
        {postsNewestFirst.length === 0 ? (
          <Text style={styles.myStatusListEmpty}>{t("status.myStatusListEmpty")}</Text>
        ) : (
          postsNewestFirst.map((post) => (
            <MyStatusListRow
              key={post.id}
              post={post}
              styles={styles}
              colors={colors}
              t={t}
              onOpen={() => openPost(post.id)}
              onOpenMenu={onOpenMenu}
            />
          ))
        )}

        <Pressable
          style={styles.myStatusArchiveRow}
          onPress={onArchivePress}
          accessibilityRole="button"
        >
          <Ionicons name="time-outline" size={22} color={colors.textMuted} />
          <Text style={styles.myStatusArchiveLabel}>
            {t("status.archiveLabel")}
          </Text>
        </Pressable>

        <View style={styles.myStatusPrivacyBlock}>
          <Ionicons
            name="lock-closed"
            size={14}
            color={colors.textMuted}
            style={styles.myStatusPrivacyIcon}
          />
          <Text style={styles.myStatusPrivacyText}>
            {t("status.privacyPrefix")}
            <Text style={styles.myStatusPrivacyAccent}>
              {t("status.privacyAccent")}
            </Text>
            {t("status.privacySuffix")}
          </Text>
        </View>
      </ScrollView>

      <View
        style={[styles.myStatusFabColumn, { bottom: fabBottom }]}
        pointerEvents="box-none"
      >
        <Pressable
          style={[
            styles.myStatusFabSmall,
            { backgroundColor: colors.surfaceMuted },
          ]}
          onPress={openCreateText}
          accessibilityRole="button"
          accessibilityLabel={t("status.modeText")}
        >
          <Ionicons name="create-outline" size={22} color={colors.text} />
        </Pressable>
        <Pressable
          style={[styles.myStatusFabLarge, { backgroundColor: colors.accent }]}
          onPress={openCreatePhoto}
          accessibilityRole="button"
          accessibilityLabel={t("status.modePhoto")}
        >
          <Ionicons name="camera" size={26} color={colors.accentOn} />
        </Pressable>
      </View>

      <MyStatusRowMenu
        visible={menuPost != null && menuAnchor != null}
        post={menuPost}
        anchor={menuAnchor}
        onDismiss={closeMenu}
        onForward={onMenuForward}
        onEdit={onMenuEdit}
        onShare={onMenuShare}
        onDelete={onMenuDelete}
      />

      <MyStatusDeleteConfirmModal
        visible={deleteTarget != null}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </SafeAreaView>
  );
}
