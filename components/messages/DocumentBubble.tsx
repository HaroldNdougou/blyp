import type { createMessagesStyles } from "@/components/messages/messagesStyles";
import { modalPresentation } from "@/lib/perf/instantMotion";
import type { ChatMessage } from "@/lib/api/types";
import { cacheDocumentFile, peekDocumentCache } from "@/lib/document/cache";
import { formatDocumentMetaLine } from "@/lib/document/formatDocumentMeta";
import {
  isPdfDocument,
  isRasterDocumentPreview,
} from "@/lib/document/kind";
import { peekPdfThumbUri } from "@/lib/document/pdfThumb";
import { resolveRemoteDocumentThumbUri } from "@/lib/document/thumbRemote";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { ThemeColors } from "@/lib/theme/colors";

type Props = {
  message: ChatMessage;
  conversationId: string;
  token: string | null;
  mine: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createMessagesStyles>;
  selectionActive?: boolean;
  onSelectionPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
};

function DocumentPagePlaceholder({ colors }: { colors: ThemeColors }) {
  const line = colors.documentPreviewLine;
  return (
    <View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 }}>
      <View
        style={{
          height: 5,
          width: "72%",
          borderRadius: 2,
          backgroundColor: line,
          opacity: 0.55,
          marginBottom: 7,
        }}
      />
      <View
        style={{
          height: 4,
          width: "92%",
          borderRadius: 2,
          backgroundColor: line,
          opacity: 0.4,
          marginBottom: 5,
        }}
      />
      <View
        style={{
          height: 4,
          width: "88%",
          borderRadius: 2,
          backgroundColor: line,
          opacity: 0.35,
          marginBottom: 5,
        }}
      />
      <View
        style={{
          height: 4,
          width: "60%",
          borderRadius: 2,
          backgroundColor: line,
          opacity: 0.3,
        }}
      />
    </View>
  );
}

function thumbCacheKey(
  doc: NonNullable<ChatMessage["document"]>,
  clientId: string | null,
): string {
  const key = String(doc.key ?? "").trim();
  if (key) return key;
  const local = String(doc.localUri ?? "").trim();
  if (local) return `local:${local}`;
  const cid = String(clientId ?? "").trim();
  return cid ? `pending:${cid}` : "";
}

export function DocumentBubble({
  message,
  conversationId,
  token,
  mine,
  colors,
  styles,
  selectionActive = false,
  onSelectionPress,
  onLongPress,
  delayLongPress,
}: Props) {
  const { t } = useTranslation();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const doc = message.document;
  const [busy, setBusy] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [imageViewerOpen, setImageViewerOpen] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState<number | undefined>(
    doc?.pageCount && doc.pageCount > 0 ? doc.pageCount : undefined,
  );

  useEffect(() => {
    if (doc?.pageCount && doc.pageCount > 0) {
      setPageCount(doc.pageCount);
    }
  }, [doc?.pageCount]);

  useEffect(() => {
    if (!doc) return;
    const local = String(doc.localUri ?? "").trim();
    if (isRasterDocumentPreview(doc.fileName, doc.contentType) && local) {
      setPreviewUri(local);
      setThumbLoading(false);
      return;
    }

    const serverThumb = String(doc.thumbKey ?? "").trim();
    if (serverThumb && token) {
      let cancelled = false;
      setThumbLoading(true);
      void resolveRemoteDocumentThumbUri(token, conversationId, serverThumb)
        .then((uri) => {
          if (!cancelled && uri) setPreviewUri(uri);
        })
        .finally(() => {
          if (!cancelled) setThumbLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    const pendingKey = thumbCacheKey(doc, message.clientId);
    if (!pendingKey) {
      setPreviewUri(null);
      setThumbLoading(false);
      return;
    }

    let cancelled = false;
    setThumbLoading(true);
    void peekPdfThumbUri(pendingKey).then((uri) => {
      if (!cancelled) {
        if (uri) setPreviewUri(uri);
        setThumbLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    doc,
    doc?.thumbKey,
    doc?.contentType,
    doc?.fileName,
    doc?.localUri,
    message.clientId,
    token,
  ]);

  const resolveLocalPath = useCallback(async (): Promise<string | null> => {
    if (!doc) return null;
    const local = String(doc.localUri ?? "").trim();
    if (local) return local;
    if (!token || !doc.key) return null;
    const cached = await peekDocumentCache(doc.key);
    if (cached) return cached;
    const { presignDocumentDownload } = await import("@/lib/api/client");
    const { url } = await presignDocumentDownload(
      token,
      conversationId,
      doc.key,
    );
    return cacheDocumentFile(doc.key, url);
  }, [conversationId, doc, token]);

  const open = useCallback(async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      const path = await resolveLocalPath();
      if (!path) return;
      if (isRasterDocumentPreview(doc.fileName, doc.contentType)) {
        setViewerUri(path);
        setImageViewerOpen(true);
        return;
      }
      const { openDocumentWithViewer } = await import("@/lib/document/open");
      await openDocumentWithViewer(path, doc.fileName, doc.contentType);
    } catch {
      Alert.alert(t("messages.title"), t("messages.documentOpenFailed"));
    } finally {
      setBusy(false);
    }
  }, [busy, doc, resolveLocalPath, t]);

  const handlePress = useCallback(() => {
    if (selectionActive) {
      onSelectionPress?.();
      return;
    }
    void open();
  }, [onSelectionPress, open, selectionActive]);

  if (!doc) return null;
  const ink = mine ? colors.bubbleMineText : colors.bubbleTheirsText;
  const metaInk = mine ? colors.bubbleMineText : colors.bubbleTheirsText;
  const isPdf = isPdfDocument(doc.fileName, doc.contentType);
  const showPdfPlaceholder = isPdf && !previewUri && thumbLoading;

  return (
    <>
    <Pressable
      style={styles.documentCard}
      onPress={handlePress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      accessibilityRole="button"
      accessibilityLabel={t("messages.documentOpenA11y", { name: doc.fileName })}
    >
      <View
        style={[
          styles.documentPreviewFrame,
          { backgroundColor: colors.documentPreviewPage },
        ]}
      >
        {previewUri ? (
          <Image
            source={{ uri: previewUri }}
            style={styles.documentPreviewImage}
            contentFit="cover"
            transition={0}
          />
        ) : showPdfPlaceholder ? (
          <View style={styles.documentPreviewFallback}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        ) : isPdf ? (
          <DocumentPagePlaceholder colors={colors} />
        ) : (
          <View style={styles.documentPreviewFallback}>
            {busy ? (
              <ActivityIndicator size="small" color={ink} />
            ) : (
              <Text style={{ color: ink, fontSize: 28, fontWeight: "600" }}>
                {doc.fileName.split(".").pop()?.slice(0, 4).toUpperCase() ??
                  "DOC"}
              </Text>
            )}
          </View>
        )}
      </View>
      <View style={styles.documentCardFooter}>
        <Text style={[styles.documentName, { color: ink }]} selectable>
          {doc.fileName}
        </Text>
        <Text
          style={[styles.documentMeta, { color: metaInk, opacity: 0.72 }]}
          numberOfLines={1}
        >
          {formatDocumentMetaLine(
            t,
            doc.fileName,
            doc.sizeBytes,
            doc.contentType,
            pageCount,
          )}
        </Text>
      </View>
    </Pressable>
    <Modal
      visible={imageViewerOpen}
      transparent
      animationType={modalPresentation}
      onRequestClose={() => setImageViewerOpen(false)}
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: colors.overlay,
          alignItems: "center",
          justifyContent: "center",
        }}
        onPress={() => setImageViewerOpen(false)}
        accessibilityLabel={t("common.close")}
      >
        {viewerUri ? (
          <Image
            source={{ uri: viewerUri }}
            style={{ width: screenW, height: screenH * 0.85 }}
            contentFit="contain"
          />
        ) : null}
      </Pressable>
    </Modal>
    </>
  );
}
