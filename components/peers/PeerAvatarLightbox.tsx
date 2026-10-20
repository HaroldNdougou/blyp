import { useTheme } from "@/contexts/ThemeContext";
import type { ThemeColors } from "@/lib/theme/colors";
import { resolvePeerAvatarUri } from "@/lib/peers/resolvePeerAvatarUri";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type PeerAvatarLightboxTarget = {
  name: string;
  phone?: string | null;
  remoteUrl?: string | null;
  localUri?: string | null;
  conversationId?: string;
  /** Déjà dans le fil : pas d’icône « ouvrir la discussion ». */
  inThread?: boolean;
};

type Props = {
  target: PeerAvatarLightboxTarget | null;
  onClose: () => void;
  onOpenChat?: (conversationId: string) => void;
};

type Mode = "card" | "fullscreen";

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1 },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    card: {
      width: "100%",
      maxWidth: 400,
      borderRadius: 4,
      overflow: "hidden",
      backgroundColor: c.surface,
    },
    imageTap: {
      width: "100%",
      aspectRatio: 1,
      backgroundColor: c.avatarBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    nameOverlay: {
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: c.imageMetaScrim,
    },
    nameOverlayText: {
      color: c.textInverse,
      fontSize: 16,
      fontWeight: "600",
    },
    cardFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 28,
      paddingVertical: 14,
      backgroundColor: c.background,
    },
    cardFooterBtn: {
      padding: 8,
    },
    fullscreenRoot: {
      flex: 1,
      backgroundColor: c.background,
    },
    fullscreenHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 8,
      paddingBottom: 8,
      gap: 4,
    },
    headerBtn: {
      padding: 8,
    },
    fullscreenTitle: {
      flex: 1,
      fontSize: 18,
      fontWeight: "600",
      color: c.text,
    },
    fullscreenImageWrap: {
      flex: 1,
      justifyContent: "center",
    },
    initialLetter: {
      fontWeight: "700",
      color: c.avatarText,
    },
  });
}

export function PeerAvatarLightbox({
  target,
  onClose,
  onOpenChat,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const cardW = Math.min(screenW - 32, 400);

  const [mode, setMode] = useState<Mode>("card");

  const uri = useMemo(
    () =>
      target
        ? resolvePeerAvatarUri({
            remoteUrl: target.remoteUrl,
            localUri: target.localUri,
            phone: target.phone,
          })
        : null,
    [target],
  );

  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  useEffect(() => {
    if (!target) setMode("card");
  }, [target]);

  const visible = Boolean(target);
  const name = String(target?.name ?? "").trim();
  const initial = (name.charAt(0) || "?").toUpperCase();
  const showPhoto = Boolean(uri) && !failed;
  const inThread = Boolean(target?.inThread);
  const conversationId = String(target?.conversationId ?? "").trim();

  const handleRequestClose = () => {
    if (mode === "fullscreen") setMode("card");
    else onClose();
  };

  const openChatFromCard = () => {
    if (!conversationId || !onOpenChat) return;
    onClose();
    onOpenChat(conversationId);
  };

  const sharePhoto = () => {
    if (!uri) return;
    void Share.share({
      message: name ? `${name}\n${uri}` : uri,
      url: uri.startsWith("http") ? uri : undefined,
    }).catch(() => {});
  };

  const imageEl = (w: number, h: number, fit: "cover" | "contain") =>
    showPhoto ? (
      <Image
        source={{ uri: uri! }}
        style={{ width: w, height: h }}
        contentFit={fit}
        cachePolicy="memory-disk"
        transition={0}
        onError={() => setFailed(true)}
      />
    ) : (
      <Text style={[styles.initialLetter, { fontSize: Math.round(w * 0.28) }]}>
        {initial}
      </Text>
    );

  return (
    <Modal
      visible={visible}
      transparent={mode === "card"}
      animationType="fade"
      onRequestClose={handleRequestClose}
      statusBarTranslucent
    >
      {mode === "card" ? (
        <View
          style={[styles.root, { backgroundColor: colors.overlay }]}
          accessibilityViewIsModal
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityLabel={t("messages.peerPhotoCloseA11y")}
            accessibilityRole="button"
          />
          <View
            style={[
              styles.center,
              { paddingTop: insets.top, paddingBottom: insets.bottom },
            ]}
            pointerEvents="box-none"
          >
            <View style={[styles.card, { width: cardW }]} pointerEvents="auto">
              <Pressable
                onPress={() => setMode("fullscreen")}
                accessibilityLabel={t("messages.peerPhotoExpandA11y")}
                accessibilityRole="imagebutton"
              >
                <View style={styles.imageTap}>
                  {imageEl(cardW, cardW, "cover")}
                  {name ? (
                    <View style={styles.nameOverlay}>
                      <Text style={styles.nameOverlayText} numberOfLines={2}>
                        {name}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <View style={styles.cardFooter}>
                {!inThread && conversationId && onOpenChat ? (
                  <Pressable
                    style={styles.cardFooterBtn}
                    onPress={openChatFromCard}
                    accessibilityLabel={t("messages.peerPhotoMessageA11y", {
                      name,
                    })}
                    accessibilityRole="button"
                  >
                    <Ionicons
                      name="chatbubble-outline"
                      size={26}
                      color={colors.accent}
                    />
                  </Pressable>
                ) : (
                  <View style={styles.cardFooterBtn} />
                )}
                <Pressable
                  style={styles.cardFooterBtn}
                  onPress={sharePhoto}
                  accessibilityLabel={t("messages.peerPhotoShareA11y")}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="share-outline"
                    size={26}
                    color={colors.accent}
                  />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.fullscreenRoot}>
          <View style={{ paddingTop: insets.top, backgroundColor: colors.background }}>
            <View style={styles.fullscreenHeader}>
              <Pressable
                style={styles.headerBtn}
                onPress={() => setMode("card")}
                accessibilityLabel={t("common.back")}
                accessibilityRole="button"
              >
                <Ionicons name="chevron-back" size={28} color={colors.text} />
              </Pressable>
              <Text style={styles.fullscreenTitle} numberOfLines={1}>
                {name}
              </Text>
              <Pressable
                style={styles.headerBtn}
                onPress={sharePhoto}
                accessibilityLabel={t("messages.peerPhotoShareA11y")}
                accessibilityRole="button"
              >
                <Ionicons name="share-outline" size={24} color={colors.text} />
              </Pressable>
            </View>
          </View>
          <Pressable
            style={styles.fullscreenImageWrap}
            onPress={() => setMode("card")}
            accessibilityLabel={t("messages.peerPhotoCloseA11y")}
          >
            {imageEl(screenW, Math.max(screenH * 0.65, cardW), "contain")}
          </Pressable>
          <View style={{ height: insets.bottom }} />
        </View>
      )}
    </Modal>
  );
}
