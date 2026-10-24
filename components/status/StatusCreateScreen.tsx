import { StatusTextCompose } from "@/components/status/StatusTextCompose";
import { createStatusCreateStyles } from "@/components/status/statusCreateStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ApiError, listStatusFeed } from "@/lib/api/client";
import { accessTokenSubject } from "@/lib/auth/accessTokenSubject";
import {
  pickImageFromCamera,
  pickImagesFromLibrary,
} from "@/lib/image/pickFromLibrary";
import {
  fetchCameraRollPhotosPage,
  presentStatusGalleryPhotoAccessPicker,
  resolveGalleryPhotoForPublish,
  type RecentGalleryPhoto,
} from "@/lib/image/recentGallery";
import {
  applyStatusFeedSnapshot,
  mergePublishedStatusPost,
} from "@/lib/status/statusCache";
import {
  publishStatusImageFromLocalUri,
  publishStatusText,
} from "@/lib/status/publishStatusImage";
import { syncStatusFeedFromNetwork } from "@/lib/status/statusSync";
import {
  STATUS_TEXT_BACKGROUNDS,
  STATUS_TEXT_FONT_VARIANTS,
} from "@/lib/status/textStatusPalette";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { pushStatusGridLocalPicks } from "@/lib/status/statusGridLocalCache";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Image as RnImage,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";

type Step = "hub" | "photo" | "text";

const COMPOSE_SLIDE_MS = 320;
/** Clavier commence à descendre avant le slide de sortie. */
const KEYBOARD_LEAD_BEFORE_COMPOSE_SLIDE_MS = 120;

type GridRow =
  | { kind: "camera"; id: "camera" }
  | { kind: "photo"; id: string; uri: string };

export function StatusCreateScreen() {
  const { mode: createMode } = useLocalSearchParams<{ mode?: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStatusCreateStyles(colors), [colors]);
  const { token } = useAuth();
  const { width: screenW } = useWindowDimensions();
  const composeSlideX = useSharedValue(screenW);
  const insets = useSafeAreaInsets();
  const galleryFabBottom = insets.bottom + 8;
  const galleryScrollBottomPad = galleryFabBottom + 56;
  const columns = 3;
  const tileSize = Math.floor(screenW / columns);
  const tilePad = 1;
  const tileImageSize = tileSize - tilePad * 2;

  const [step, setStep] = useState<Step>("hub");
  const [composeLayerOpen, setComposeLayerOpen] = useState(false);
  const [composeLayerStep, setComposeLayerStep] = useState<"text" | "photo">(
    "text",
  );
  const [photos, setPhotos] = useState<RecentGalleryPhoto[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);
  const [rollCursor, setRollCursor] = useState<string | undefined>();
  const [rollHasMore, setRollHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [galleryAccessDenied, setGalleryAccessDenied] = useState(false);
  const [galleryNeedsSelection, setGalleryNeedsSelection] = useState(false);

  const refreshGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      const page = await fetchCameraRollPhotosPage({ requestPermission: true });
      setPhotos(page.photos);
      setRollCursor(page.endCursor);
      setRollHasMore(page.hasNextPage);
      setGalleryAccessDenied(Boolean(page.accessDenied));
      setGalleryNeedsSelection(Boolean(page.needsPhotoSelection));
    } catch {
      setPhotos([]);
      setRollHasMore(false);
      setRollCursor(undefined);
      setGalleryAccessDenied(false);
      setGalleryNeedsSelection(false);
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  const onGrantRecentsPress = useCallback(() => {
    void refreshGallery();
  }, [refreshGallery]);

  const onSelectPhotosForGrid = useCallback(() => {
    void (async () => {
      await presentStatusGalleryPhotoAccessPicker();
      await refreshGallery();
    })();
  }, [refreshGallery]);

  const onOpenAppSettings = useCallback(() => {
    void Linking.openSettings();
  }, []);

  const loadMoreGallery = useCallback(async () => {
    if (!rollHasMore || !rollCursor || loadingMore || galleryLoading) return;
    setLoadingMore(true);
    try {
      const page = await fetchCameraRollPhotosPage({
        after: rollCursor,
        requestPermission: false,
      });
      setPhotos((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const extra = page.photos.filter((p) => !seen.has(p.id));
        return [...prev, ...extra];
      });
      setRollCursor(page.endCursor);
      setRollHasMore(page.hasNextPage);
    } catch {
      setRollHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [rollCursor, rollHasMore, loadingMore, galleryLoading]);
  const [uri, setUri] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [textBody, setTextBody] = useState("");
  const [textBgIndex, setTextBgIndex] = useState(0);
  const [textFontIndex, setTextFontIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const textBackground =
    STATUS_TEXT_BACKGROUNDS[
      textBgIndex % STATUS_TEXT_BACKGROUNDS.length
    ] ?? STATUS_TEXT_BACKGROUNDS[0];
  const textFontVariant =
    STATUS_TEXT_FONT_VARIANTS[
      textFontIndex % STATUS_TEXT_FONT_VARIANTS.length
    ] ?? STATUS_TEXT_FONT_VARIANTS[0];

  const gridData: GridRow[] = useMemo(
    () => [
      { kind: "camera", id: "camera" },
      ...photos.map((p) => ({
        kind: "photo" as const,
        id: p.id,
        uri: p.uri,
      })),
    ],
    [photos],
  );

  useFocusEffect(
    useCallback(() => {
      if (step !== "hub") return;
      void refreshGallery();
    }, [refreshGallery, step]),
  );

  const canPublish =
    step === "photo"
      ? Boolean(uri)
      : step === "text"
        ? textBody.trim().length > 0
        : false;

  const openPhotoCompose = useCallback((localUri: string) => {
    setUri(localUri);
    setCaption("");
    setComposeLayerStep("photo");
    setStep("photo");
    setComposeLayerOpen(true);
  }, []);

  const onGridPhotoPress = useCallback(
    (id: string, previewUri: string) => {
      void (async () => {
        const uri = await resolveGalleryPhotoForPublish(id, previewUri);
        openPhotoCompose(uri);
      })();
    },
    [openPhotoCompose],
  );

  const onCamera = useCallback(async () => {
    const picked = await pickImageFromCamera();
    if (picked?.uri) openPhotoCompose(picked.uri);
  }, [openPhotoCompose]);

  const onOpenLibrary = useCallback(async () => {
    const picked = await pickImagesFromLibrary();
    if (picked?.length) {
      pushStatusGridLocalPicks(picked);
      void refreshGallery();
    }
    const first = picked?.[0]?.uri;
    if (first) openPhotoCompose(first);
  }, [openPhotoCompose, refreshGallery]);

  const onComingSoon = useCallback(() => {
    Alert.alert(t("status.comingSoonTitle"), t("status.comingSoonMessage"));
  }, [t]);

  const resetComposeDraft = useCallback(() => {
    setUri(null);
    setCaption("");
    setTextBody("");
    setTextBgIndex(0);
    setTextFontIndex(0);
    setComposeLayerOpen(false);
  }, []);

  const animateLeaveCompose = useCallback(
    (onDone: () => void) => {
      composeSlideX.value = withTiming(
        screenW,
        { duration: COMPOSE_SLIDE_MS },
        (finished) => {
          if (finished) runOnJS(onDone)();
        },
      );
    },
    [composeSlideX, screenW],
  );

  const returnToHub = useCallback(() => {
    Keyboard.dismiss();
    setStep("hub");
    setTimeout(() => {
      animateLeaveCompose(resetComposeDraft);
    }, KEYBOARD_LEAD_BEFORE_COMPOSE_SLIDE_MS);
  }, [animateLeaveCompose, resetComposeDraft]);

  useEffect(() => {
    composeSlideX.value = screenW;
  }, [screenW, composeSlideX]);

  useEffect(() => {
    if (!composeLayerOpen) return;
    if (step !== "text" && step !== "photo") return;
    composeSlideX.value = screenW;
    composeSlideX.value = withTiming(0, { duration: COMPOSE_SLIDE_MS });
  }, [composeLayerOpen, step, screenW, composeSlideX]);

  const composeSlideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: composeSlideX.value }],
  }));

  const hasComposeDraft = useMemo(() => {
    if (composeLayerStep === "text") return textBody.trim().length > 0;
    if (composeLayerStep === "photo") {
      return Boolean(uri) || caption.trim().length > 0;
    }
    return false;
  }, [composeLayerStep, textBody, uri, caption]);

  const requestLeaveCompose = useCallback(
    (onLeave: () => void) => {
      if (!hasComposeDraft) {
        onLeave();
        return;
      }
      Alert.alert(t("status.discardDraftTitle"), undefined, [
        { text: t("status.discardDraftStay"), style: "cancel" },
        {
          text: t("status.discardDraftConfirm"),
          style: "destructive",
          onPress: onLeave,
        },
      ]);
    },
    [hasComposeDraft, t],
  );

  const openTextCompose = useCallback(() => {
    setTextBody("");
    setTextBgIndex(0);
    setTextFontIndex(0);
    setComposeLayerStep("text");
    setStep("text");
    setComposeLayerOpen(true);
  }, []);

  const textEntryOpenedRef = useRef(false);
  useEffect(() => {
    if (createMode !== "text" || textEntryOpenedRef.current) return;
    textEntryOpenedRef.current = true;
    openTextCompose();
  }, [createMode, openTextCompose]);

  const close = useCallback(() => {
    if (composeLayerOpen) {
      requestLeaveCompose(returnToHub);
      return;
    }
    router.back();
  }, [returnToHub, composeLayerOpen, requestLeaveCompose]);

  useFocusEffect(
    useCallback(() => {
      if (!composeLayerOpen) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        requestLeaveCompose(returnToHub);
        return true;
      });
      return () => sub.remove();
    }, [composeLayerOpen, requestLeaveCompose, returnToHub]),
  );

  const finishAfterPublish = useCallback(
    (post: import("@/lib/api/types").StatusPost) => {
      const myId = accessTokenSubject(token) ?? "";
      if (myId) mergePublishedStatusPost(post, myId);
      if (token) {
        syncStatusFeedFromNetwork(token, { force: true });
        void listStatusFeed(token)
          .then((feed) => applyStatusFeedSnapshot(feed.items, feed.myUserId))
          .catch(() => {});
      }
      router.back();
    },
    [token],
  );

  const publishFailureMessage = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.message.trim()) return e.message;
      return t("common.genericError");
    },
    [t],
  );

  const publishTextStatus = useCallback(async () => {
    if (!token || busy) return;
    const body = textBody.trim();
    if (!body) return;
    setBusy(true);
    try {
      const post = await publishStatusText(token, body, {
        bgIndex: textBgIndex,
        fontIndex: textFontIndex,
      });
      finishAfterPublish(post);
    } catch (e) {
      if (__DEV__) console.warn("[status] publish text failed", e);
      Alert.alert(t("status.createTitle"), publishFailureMessage(e));
    } finally {
      setBusy(false);
    }
  }, [
    token,
    busy,
    textBody,
    textBgIndex,
    textFontIndex,
    finishAfterPublish,
    publishFailureMessage,
    t,
  ]);

  const publishPhotoStatus = useCallback(async () => {
    if (!token || busy || !uri) return;
    setBusy(true);
    try {
      const post = await publishStatusImageFromLocalUri(
        token,
        uri,
        caption.trim() || null,
      );
      finishAfterPublish(post);
    } catch (e) {
      if (__DEV__) console.warn("[status] publish photo failed", e);
      Alert.alert(t("status.createTitle"), publishFailureMessage(e));
    } finally {
      setBusy(false);
    }
  }, [
    token,
    busy,
    uri,
    caption,
    finishAfterPublish,
    publishFailureMessage,
    t,
  ]);

  const listHeader = useMemo(
    () => (
      <View>
        <View style={styles.actionRow}>
          <Pressable
            style={styles.actionItem}
            onPress={openTextCompose}
            accessibilityRole="button"
            accessibilityLabel={t("status.actionText")}
          >
            <View style={styles.actionCircle}>
              <Ionicons name="create-outline" size={26} color={colors.text} />
            </View>
            <Text style={styles.actionLabel}>{t("status.actionText")}</Text>
          </Pressable>
          <Pressable
            style={styles.actionItem}
            onPress={onComingSoon}
            accessibilityRole="button"
            accessibilityLabel={t("status.actionMusic")}
          >
            <View style={styles.actionCircle}>
              <Ionicons
                name="musical-notes-outline"
                size={26}
                color={colors.text}
              />
            </View>
            <Text style={styles.actionLabel}>{t("status.actionMusic")}</Text>
          </Pressable>
          <Pressable
            style={styles.actionItem}
            onPress={onComingSoon}
            accessibilityRole="button"
            accessibilityLabel={t("status.actionLayout")}
          >
            <View style={styles.actionCircle}>
              <Ionicons name="copy-outline" size={24} color={colors.text} />
            </View>
            <Text style={styles.actionLabel}>{t("status.actionLayout")}</Text>
          </Pressable>
          <Pressable
            style={styles.actionItem}
            onPress={onComingSoon}
            accessibilityRole="button"
            accessibilityLabel={t("status.actionVoice")}
          >
            <View style={styles.actionCircle}>
              <Ionicons name="mic-outline" size={26} color={colors.text} />
            </View>
            <Text style={styles.actionLabel}>{t("status.actionVoice")}</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.recentsRow}
          accessibilityRole="button"
          accessibilityLabel={t("status.recents")}
        >
          <Text style={styles.recentsLabel}>{t("status.recents")}</Text>
          <Ionicons name="chevron-down" size={18} color={colors.text} />
        </Pressable>
        {!galleryLoading && photos.length === 0 ? (
          <View style={styles.recentsEmptyWrap}>
            {galleryNeedsSelection ? (
              <>
                <Text style={styles.recentsEmptyHint}>
                  {t("status.gallerySelectPhotosHint")}
                </Text>
                <Pressable
                  onPress={onSelectPhotosForGrid}
                  accessibilityRole="button"
                  accessibilityLabel={t("status.gallerySelectPhotosAction")}
                >
                  <Text style={styles.recentsEnable}>
                    {t("status.gallerySelectPhotosAction")}
                  </Text>
                </Pressable>
              </>
            ) : null}
            {galleryAccessDenied ? (
              <>
                <Text style={styles.recentsEmptyHint}>
                  {t("status.galleryPermissionHint")}
                </Text>
                <Text style={[styles.recentsEmptyHint, { marginBottom: 12 }]}>
                  {t("status.recentsNeedRead")}
                </Text>
                <Pressable
                  onPress={onGrantRecentsPress}
                  accessibilityRole="button"
                  accessibilityLabel={t("status.galleryPermissionRetry")}
                >
                  <Text style={styles.recentsEnable}>
                    {t("status.galleryPermissionRetry")}
                  </Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              onPress={onOpenAppSettings}
              style={{ marginTop: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t("status.openAppSettings")}
            >
              <Text style={styles.recentsEnable}>{t("status.openAppSettings")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    ),
    [
      colors.text,
      galleryAccessDenied,
      galleryNeedsSelection,
      galleryLoading,
      photos.length,
      onComingSoon,
      onGrantRecentsPress,
      onSelectPhotosForGrid,
      onOpenAppSettings,
      openTextCompose,
      styles,
      t,
    ],
  );

  const gridRows = useMemo(() => {
    const rows: GridRow[][] = [];
    for (let i = 0; i < gridData.length; i += columns) {
      rows.push(gridData.slice(i, i + columns));
    }
    return rows;
  }, [gridData, columns]);

  const onGalleryScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const nearBottom =
        layoutMeasurement.height + contentOffset.y >= contentSize.height - 320;
      if (nearBottom) void loadMoreGallery();
    },
    [loadMoreGallery],
  );

  const renderGridTile = useCallback(
    (item: GridRow) => {
      const tileStyle = {
        width: tileSize,
        height: tileSize,
        padding: tilePad,
      };
      const imagePxStyle = {
        width: tileImageSize,
        height: tileImageSize,
      };
      if (item.kind === "camera") {
        return (
          <Pressable
            key={item.id}
            onPress={() => void onCamera()}
            style={[styles.cameraCell, tileStyle]}
            accessibilityRole="button"
            accessibilityLabel={t("status.camera")}
          >
            <Ionicons name="camera-outline" size={28} color={colors.accent} />
            <Text style={styles.cameraLabel}>{t("status.camera")}</Text>
          </Pressable>
        );
      }
      return (
        <Pressable
          key={item.id}
          onPress={() => onGridPhotoPress(item.id, item.uri)}
          style={[styles.gridCell, tileStyle]}
          accessibilityRole="button"
        >
          <RnImage
            source={{ uri: item.uri }}
            style={imagePxStyle}
            resizeMode="cover"
          />
        </Pressable>
      );
    },
    [
      tileSize,
      tilePad,
      tileImageSize,
      colors.accent,
      onGridPhotoPress,
      onCamera,
      styles,
      t,
    ],
  );

  return (
    <View style={styles.root}>
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerSide}
          onPress={close}
          accessibilityLabel={t("common.close")}
        >
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t("status.createTitle")}
        </Text>
        <View style={styles.headerSide} />
      </View>

      <View
        style={styles.listWrap}
        pointerEvents={composeLayerOpen ? "none" : "auto"}
      >
          <ScrollView
            style={{ flex: 1 }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: galleryScrollBottomPad }}
            onScroll={onGalleryScroll}
            scrollEventThrottle={120}
          >
            {listHeader}
            {galleryLoading && photos.length === 0 ? (
              <ActivityIndicator
                color={colors.accent}
                style={{ paddingVertical: 24 }}
              />
            ) : null}
            {gridRows.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={{ flexDirection: "row" }}>
                {row.map((item) => renderGridTile(item))}
              </View>
            ))}
            {loadingMore ? (
              <ActivityIndicator
                color={colors.accent}
                style={{ paddingVertical: 16 }}
              />
            ) : null}
          </ScrollView>
          <Pressable
            style={[styles.galleryFab, { bottom: galleryFabBottom }]}
            onPress={() => void onOpenLibrary()}
            accessibilityRole="button"
            accessibilityLabel={t("status.openGallery")}
          >
            <Ionicons name="images-outline" size={24} color={colors.text} />
          </Pressable>
        </View>

    </SafeAreaView>

    {composeLayerOpen ? (
      <Animated.View
        style={[StyleSheet.absoluteFill, composeSlideStyle, styles.composeSlide]}
      >
        {composeLayerStep === "text" ? (
          <StatusTextCompose
            backgroundColor={textBackground}
            bgIndex={textBgIndex}
            onSelectBgIndex={setTextBgIndex}
            value={textBody}
            onChangeText={setTextBody}
            fontVariant={textFontVariant}
            fontIndex={textFontIndex}
            onSelectFontIndex={setTextFontIndex}
            onClose={() => requestLeaveCompose(returnToHub)}
            onMention={onComingSoon}
            onSend={() => void publishTextStatus()}
            sendDisabled={!canPublish}
            busy={busy}
          />
        ) : null}
        {composeLayerStep === "photo" && uri ? (
          <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
            <View style={styles.header}>
              <Pressable
                style={styles.headerSide}
                onPress={close}
                accessibilityLabel={t("common.back")}
              >
                <Ionicons name="arrow-back" size={26} color={colors.text} />
              </Pressable>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {t("status.modePhoto")}
              </Text>
              <Pressable
                style={styles.headerSide}
                onPress={() => void publishPhotoStatus()}
                disabled={!canPublish || busy}
                accessibilityLabel={t("status.publish")}
              >
                {busy ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Text
                    style={[
                      styles.publishLabel,
                      !canPublish && styles.publishLabelDisabled,
                    ]}
                  >
                    {t("status.publish")}
                  </Text>
                )}
              </Pressable>
            </View>
            <View style={styles.composePreview}>
              <Image source={{ uri }} style={{ flex: 1 }} contentFit="cover" />
            </View>
            <TextInput
              style={styles.composeField}
              placeholder={t("status.captionPlaceholder")}
              placeholderTextColor={colors.placeholder}
              value={caption}
              onChangeText={setCaption}
              multiline
              maxLength={280}
            />
          </SafeAreaView>
        ) : null}
      </Animated.View>
    ) : null}
    </View>
  );
}
