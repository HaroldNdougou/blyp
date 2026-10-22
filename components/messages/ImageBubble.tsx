import type { ChatMessage } from "@/lib/api/types";
import { CHAT_LONG_PRESS_MS } from "@/lib/messages/chatEmojiConstants";
import { imageBubbleSize } from "@/lib/image/thumbSize";
import { peekImageCache } from "@/lib/image/cache";
import { cacheImageFile } from "@/lib/image/upload";
import { modalPresentation } from "@/lib/perf/instantMotion";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type ImageStyle,
  type StyleProp,
} from "react-native";

type Styles = {
  imageThumb: StyleProp<ImageStyle>;
  imageWrap: StyleProp<ImageStyle>;
};

type Props = {
  message: ChatMessage;
  conversationId: string;
  token: string | null;
  styles: Styles;
  /** Heure + coches sur l’image (pas de légende). */
  overlayMeta?: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
};

export const ImageBubble = React.memo(function ImageBubble({
  message,
  conversationId,
  token,
  styles,
  overlayMeta,
  onPress,
  onLongPress,
  delayLongPress = CHAT_LONG_PRESS_MS,
}: Props) {
  const { t } = useTranslation();
  const { width: screenW } = useWindowDimensions();
  const img = message.image;
  const [uri, setUri] = useState<string | null>(
    String(img?.localUri ?? "").trim() || null,
  );
  const [hdUri, setHdUri] = useState<string | null>(null);
  const [fullOpen, setFullOpen] = useState(false);
  const [measured, setMeasured] = useState({
    w: img?.width ?? 0,
    h: img?.height ?? 0,
  });

  useEffect(() => {
    setMeasured({
      w: img?.width ?? 0,
      h: img?.height ?? 0,
    });
  }, [img?.width, img?.height]);

  const dims = useMemo(
    () => imageBubbleSize(measured.w, measured.h, screenW),
    [measured.w, measured.h, screenW],
  );

  const placeholder = useMemo(
    () =>
      img?.blurhash ? { blurhash: String(img.blurhash) } : undefined,
    [img?.blurhash],
  );

  const fetchKey = useCallback(
    async (key: string): Promise<string | null> => {
      if (!key || !token) return null;
      const cached = await peekImageCache(key);
      if (cached) return cached;
      const api = await import("@/lib/api/client");
      const { url } = await api.presignImagePlay(token, conversationId, key);
      return cacheImageFile(key, url);
    },
    [conversationId, token],
  );

  const resolveRemote = useCallback(async () => {
    const mainKey = String(img?.key ?? "").trim();
    const thumbKey = String(img?.thumbKey ?? "").trim();
    if (!mainKey || !token) return;

    if (thumbKey) {
      const thumbLocal = await fetchKey(thumbKey);
      if (thumbLocal) setUri(thumbLocal);
    }

    const hdLocal = await fetchKey(mainKey);
    if (hdLocal) {
      setHdUri(hdLocal);
      setUri(hdLocal);
    }
  }, [fetchKey, img?.key, img?.thumbKey, token]);

  useEffect(() => {
    const local = String(img?.localUri ?? "").trim();
    if (local) {
      setUri(local);
      setHdUri(local);
      return;
    }
    const mainKey = String(img?.key ?? "").trim();
    if (!mainKey) return;

    void (async () => {
      const thumbKey = String(img?.thumbKey ?? "").trim();
      if (thumbKey) {
        const thumbHit = await peekImageCache(thumbKey);
        if (thumbHit) setUri(thumbHit);
      }
      const mainHit = await peekImageCache(mainKey);
      if (mainHit) {
        setUri(mainHit);
        setHdUri(mainHit);
        return;
      }
      await resolveRemote().catch(() => {});
    })();
  }, [img?.key, img?.thumbKey, img?.localUri, resolveRemote]);

  const displayUri = hdUri ?? uri;

  const openFull = () => {
    onPress?.();
    if (!displayUri) {
      void resolveRemote()
        .then(() => setFullOpen(true))
        .catch(() => {});
      return;
    }
    setFullOpen(true);
  };

  return (
    <>
      <Pressable
        onPress={openFull}
        onLongPress={onLongPress}
        delayLongPress={delayLongPress}
        accessibilityRole="image"
        accessibilityLabel={t("messages.imageA11y")}
        style={styles.imageWrap}
      >
        <Image
          source={displayUri ? { uri: displayUri } : undefined}
          placeholder={placeholder}
          style={[styles.imageThumb, { width: dims.width, height: dims.height }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={message.id}
          transition={displayUri === hdUri && uri !== hdUri ? 160 : 80}
          onLoad={(e) => {
            const w = e.source.width;
            const h = e.source.height;
            if (w > 0 && h > 0 && (measured.w <= 0 || measured.h <= 0)) {
              setMeasured({ w, h });
            }
          }}
        />
        {overlayMeta ? (
          <View style={localStyles.metaHost} pointerEvents="none">
            {overlayMeta}
          </View>
        ) : null}
      </Pressable>
      <Modal
        visible={fullOpen}
        transparent
        animationType={modalPresentation}
        onRequestClose={() => setFullOpen(false)}
      >
        <Pressable
          style={localStyles.backdrop}
          onPress={() => setFullOpen(false)}
          accessibilityLabel={t("common.close")}
        >
          {displayUri ? (
            <Image
              source={{ uri: displayUri }}
              style={localStyles.full}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
});

const localStyles = StyleSheet.create({
  metaHost: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  full: {
    width: "100%",
    height: "100%",
  },
});
