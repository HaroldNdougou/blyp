import { createReceiptsStyles } from "@/components/receipts/receiptsStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { pickDocumentFromDevice } from "@/lib/document/pick";
import { openDocumentWithViewer } from "@/lib/document/open";
import { formatFileSize, formatTransactionDate } from "@/lib/format";
import {
  ensureCameraPermission,
  pickImageFromCamera,
} from "@/lib/image/pickFromLibrary";
import type { MerchantReceipt } from "@/lib/receipts/types";
import {
  addMerchantReceipt,
  deleteMerchantReceipt,
  getReceiptsSnapshot,
  hydrateReceiptsCache,
  setReceiptsSnapshot,
} from "@/lib/receipts/receiptsStore";
import { takeUnreadReceiptIds } from "@/lib/receipts/receiptsUnread";
import FS from "@/lib/voice/fileSystem";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

type ReceiptFilter = "all" | "date" | "shop" | "service";

type PendingFile = {
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export function ReceiptsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createReceiptsStyles(colors), [colors]);
  const { user } = useAuth();

  const accountId = String(user?.id ?? "").trim();
  const [filter, setFilter] = useState<ReceiptFilter>("all");
  const [items, setItems] = useState<MerchantReceipt[]>(() => {
    const snap = accountId ? getReceiptsSnapshot(accountId) : null;
    return snap ?? [];
  });
  const [hydrating, setHydrating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [receiptName, setReceiptName] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [saving, setSaving] = useState(false);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(
    () => new Set(),
  );

  const chips: { id: ReceiptFilter; label: string }[] = [
    { id: "all", label: t("receipts.filterAll") },
    { id: "date", label: t("receipts.filterDate") },
    { id: "shop", label: t("receipts.filterShop") },
    { id: "service", label: t("receipts.filterService") },
  ];

  const visibleItems = useMemo(() => {
    let list = items;
    if (filter === "shop") {
      list = list.filter((r) => r.category === "shop");
    } else if (filter === "service") {
      list = list.filter((r) => r.category === "service");
    }
    return list;
  }, [items, filter]);

  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      const pendingUnread = takeUnreadReceiptIds(accountId);
      if (pendingUnread.size > 0) {
        setHighlightIds(new Set(pendingUnread));
      }
      const snap = getReceiptsSnapshot(accountId);
      if (snap) setItems(snap);
      const task = InteractionManager.runAfterInteractions(() => {
        setHydrating(true);
        void hydrateReceiptsCache(accountId)
          .then(() => {
            const next = getReceiptsSnapshot(accountId);
            if (next) setItems(next);
          })
          .finally(() => setHydrating(false));
      });
      return () => task.cancel();
    }, [accountId]),
  );

  const defaultNameFromFile = (fileName: string) => {
    const base = String(fileName ?? "").trim();
    const dot = base.lastIndexOf(".");
    if (dot > 0) return base.slice(0, dot);
    return base || t("receipts.defaultName");
  };

  const queueFile = (file: PendingFile) => {
    setPending(file);
    setReceiptName(defaultNameFromFile(file.fileName));
    setMerchantName("");
    setAddOpen(false);
  };

  const onCamera = async () => {
    const ok = await ensureCameraPermission();
    if (!ok) {
      Alert.alert(t("receipts.title"), t("messages.cameraPermissionDenied"));
      return;
    }
    const shot = await pickImageFromCamera();
    if (!shot) return;
    const fileName = `receipt-${Date.now()}.jpg`;
    let sizeBytes = 0;
    try {
      const info = await FS.getInfoAsync(shot.uri);
      if (info.exists && typeof info.size === "number") {
        sizeBytes = Math.floor(info.size);
      }
    } catch {
      /* ignore */
    }
    if (sizeBytes <= 0) sizeBytes = 1;
    queueFile({
      uri: shot.uri,
      fileName,
      contentType: shot.contentType,
      sizeBytes,
    });
  };

  const onPickFile = async () => {
    try {
      const doc = await pickDocumentFromDevice();
      if (!doc) return;
      queueFile({
        uri: doc.uri,
        fileName: doc.name,
        contentType: doc.mimeType,
        sizeBytes: doc.size,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg === "DOCUMENT_SIZE") {
        Alert.alert(t("receipts.title"), t("receipts.fileTooLarge"));
        return;
      }
      Alert.alert(t("receipts.title"), t("common.genericError"));
    }
  };

  const onSave = async () => {
    if (!accountId || !pending) return;
    const name = receiptName.trim();
    if (name.length < 1) return;
    setSaving(true);
    try {
      const receipt = await addMerchantReceipt({
        accountId,
        name,
        merchantName: merchantName.trim() || null,
        localUri: pending.uri,
        fileName: pending.fileName,
        contentType: pending.contentType,
        sizeBytes: pending.sizeBytes,
      });
      setPending(null);
      setReceiptName("");
      setMerchantName("");
      setItems((prev) => {
        const next = [receipt, ...prev.filter((r) => r.id !== receipt.id)];
        setReceiptsSnapshot(accountId, next);
        return next;
      });
    } catch (e) {
      const msg =
        e instanceof Error && e.message.trim()
          ? e.message.trim()
          : t("common.genericError");
      Alert.alert(t("receipts.title"), msg);
    } finally {
      setSaving(false);
    }
  };

  const openReceipt = async (receipt: MerchantReceipt) => {
    setHighlightIds((prev) => {
      if (!prev.has(receipt.id)) return prev;
      const next = new Set(prev);
      next.delete(receipt.id);
      return next;
    });
    try {
      await openDocumentWithViewer(
        receipt.localUri,
        receipt.name,
        receipt.contentType,
      );
    } catch {
      Alert.alert(t("receipts.title"), t("receipts.openFailed"));
    }
  };

  const removeReceipt = (receipt: MerchantReceipt) => {
    Alert.alert(
      t("receipts.deleteTitle"),
      t("receipts.deleteMessage", { name: receipt.name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("receipts.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            if (!accountId) return;
            void (async () => {
              try {
                await deleteMerchantReceipt(accountId, receipt.id);
                setItems((prev) => {
                  const next = prev.filter((r) => r.id !== receipt.id);
                  setReceiptsSnapshot(accountId, next);
                  return next;
                });
              } catch {
                Alert.alert(t("receipts.title"), t("common.genericError"));
              }
            })();
          },
        },
      ],
    );
  };

  const rowMeta = (receipt: MerchantReceipt) => {
    const parts = [formatTransactionDate(receipt.createdAt)];
    if (receipt.merchantName) parts.push(receipt.merchantName);
    parts.push(formatFileSize(receipt.sizeBytes));
    return parts.join(" · ");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerBack}
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t("receipts.title")}
          </Text>
        </Pressable>
        {hydrating ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <View style={styles.filters}>
        {chips.map((c) => {
          const on = filter === c.id;
          return (
            <Pressable
              key={c.id}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => setFilter(c.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.body}>
        {visibleItems.length === 0 && !hydrating ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("receipts.emptyTitle")}</Text>
          </View>
        ) : (
          <FlatList
            data={visibleItems}
            keyExtractor={(r) => r.id}
            extraData={highlightIds.size}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable
                style={[
                  styles.row,
                  highlightIds.has(item.id) ? styles.rowUnread : null,
                ]}
                onPress={() => void openReceipt(item)}
                onLongPress={() => removeReceipt(item)}
                accessibilityRole="button"
                accessibilityLabel={item.name}
              >
                <View style={styles.rowIcon}>
                  <Ionicons
                    name="receipt-outline"
                    size={22}
                    color={colors.accent}
                  />
                </View>
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={2}>
                    {rowMeta(item)}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={colors.textFaint}
                />
              </Pressable>
            )}
          />
        )}
      </View>

      <Pressable
        style={[styles.fab, { bottom: 20 + Math.max(insets.bottom, 8) }]}
        onPress={() => setAddOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("receipts.add")}
      >
        <Ionicons name="add" size={28} color={colors.accentOn} />
      </Pressable>

      <Modal
        visible={addOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setAddOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setAddOpen(false)}
        >
          <Pressable
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Pressable style={styles.sheetRow} onPress={() => void onCamera()}>
              <Ionicons name="camera-outline" size={24} color={colors.text} />
              <Text style={styles.sheetLabel}>{t("receipts.addCamera")}</Text>
            </Pressable>
            <Pressable
              style={[styles.sheetRow, styles.sheetRowBorder]}
              onPress={() => void onPickFile()}
            >
              <Ionicons
                name="folder-open-outline"
                size={24}
                color={colors.text}
              />
              <Text style={styles.sheetLabel}>{t("receipts.addFile")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(pending)}
        transparent
        animationType="fade"
        onRequestClose={() => !saving && setPending(null)}
      >
        <View style={styles.nameModal}>
          <View style={styles.nameCard}>
            <Text style={styles.nameTitle}>{t("receipts.nameTitle")}</Text>
            <TextInput
              style={styles.nameInput}
              value={receiptName}
              onChangeText={setReceiptName}
              placeholder={t("receipts.namePlaceholder")}
              placeholderTextColor={colors.placeholder}
              autoFocus
              editable={!saving}
            />
            <Text style={styles.nameTitle}>{t("receipts.merchantTitle")}</Text>
            <TextInput
              style={styles.nameInput}
              value={merchantName}
              onChangeText={setMerchantName}
              placeholder={t("receipts.merchantPlaceholder")}
              placeholderTextColor={colors.placeholder}
              editable={!saving}
            />
            <View style={styles.nameActions}>
              <Pressable
                style={[styles.nameBtn, styles.nameBtnGhost]}
                onPress={() => !saving && setPending(null)}
                disabled={saving}
              >
                <Text style={styles.nameBtnText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={[styles.nameBtn, styles.nameBtnPrimary]}
                onPress={() => void onSave()}
                disabled={saving || receiptName.trim().length < 1}
              >
                {saving ? (
                  <ActivityIndicator color={colors.accentOn} />
                ) : (
                  <Text style={styles.nameBtnTextOn}>{t("receipts.save")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
