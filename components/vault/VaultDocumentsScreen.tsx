import { createDocumentsStyles } from "@/components/vault/documentsStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { modalPresentation } from "@/lib/perf/instantMotion";
import {
  deleteVaultDocument,
  getVaultDocumentDownload,
  listVaultDocuments,
} from "@/lib/api/client";
import type { VaultDocument } from "@/lib/api/types";
import { pickDocumentFromDevice } from "@/lib/document/pick";
import { openDocumentWithViewer } from "@/lib/document/open";
import { formatFileSize, formatTransactionDate } from "@/lib/format";
import {
  ensureCameraPermission,
  pickImageFromCamera,
} from "@/lib/image/pickFromLibrary";
import { uploadVaultDocument } from "@/lib/vault/uploadVaultDocument";
import {
  getVaultSnapshot,
  setVaultSnapshot,
} from "@/lib/vault/vaultCache";
import { Ionicons } from "@expo/vector-icons";
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
import { useFocusEffect } from "@react-navigation/native";
import FS from "@/lib/voice/fileSystemLegacy";

type PendingFile = {
  uri: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export function VaultDocumentsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createDocumentsStyles(colors), [colors]);
  const { user, token } = useAuth();

  const accountId = String(user?.id ?? "").trim();
  const [items, setItems] = useState<VaultDocument[]>(() => {
    const snap = accountId ? getVaultSnapshot(accountId) : null;
    return snap?.items ?? [];
  });
  const [usedBytes, setUsedBytes] = useState(
    () => getVaultSnapshot(accountId)?.usedBytes ?? 0,
  );
  const [maxBytes, setMaxBytes] = useState(
    () => getVaultSnapshot(accountId)?.maxBytes ?? 200 * 1024 * 1024,
  );
  const [syncing, setSyncing] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [docName, setDocName] = useState("");
  const [saving, setSaving] = useState(false);

  const applySnap = useCallback(
    (snap: Awaited<ReturnType<typeof listVaultDocuments>>) => {
      setItems(snap.items);
      setUsedBytes(snap.usedBytes);
      setMaxBytes(snap.maxBytes);
      if (snap.accountId) setVaultSnapshot(snap.accountId, snap);
    },
    [],
  );

  const refresh = useCallback(
    async (background = false) => {
      if (!token) return;
      if (!background) setSyncing(true);
      try {
        const snap = await listVaultDocuments(token);
        applySnap(snap);
      } catch {
        if (!background && items.length === 0) {
          Alert.alert(t("vault.title"), t("common.genericError"));
        }
      } finally {
        if (!background) setSyncing(false);
      }
    },
    [token, applySnap, items.length, t],
  );

  useFocusEffect(
    useCallback(() => {
      if (!token || !accountId) return;
      const snap = getVaultSnapshot(accountId);
      if (snap) {
        setItems(snap.items);
        setUsedBytes(snap.usedBytes);
        setMaxBytes(snap.maxBytes);
      }
      const task = InteractionManager.runAfterInteractions(() => {
        void refresh(true);
      });
      return () => task.cancel();
    }, [token, accountId, refresh]),
  );

  const defaultNameFromFile = (fileName: string) => {
    const base = String(fileName ?? "").trim();
    const dot = base.lastIndexOf(".");
    if (dot > 0) return base.slice(0, dot);
    return base || t("vault.defaultName");
  };

  const queueFile = (file: PendingFile) => {
    setPending(file);
    setDocName(defaultNameFromFile(file.fileName));
    setAddOpen(false);
  };

  const onCamera = async () => {
    const ok = await ensureCameraPermission();
    if (!ok) {
      Alert.alert(t("vault.title"), t("messages.cameraPermissionDenied"));
      return;
    }
    const shot = await pickImageFromCamera();
    if (!shot) return;
    const fileName = `photo-${Date.now()}.jpg`;
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
        Alert.alert(t("vault.title"), t("vault.fileTooLarge"));
        return;
      }
      Alert.alert(t("vault.title"), t("common.genericError"));
    }
  };

  const onSave = async () => {
    if (!token || !pending) return;
    const name = docName.trim();
    if (name.length < 1) return;
    setSaving(true);
    try {
      const document = await uploadVaultDocument(token, {
        name,
        localUri: pending.uri,
        fileName: pending.fileName,
        contentType: pending.contentType,
        sizeBytes: pending.sizeBytes,
      });
      setPending(null);
      setDocName("");
      setItems((prev) => {
        const next = [document, ...prev.filter((d) => d.id !== document.id)];
        const used = next.reduce((a, d) => a + d.sizeBytes, 0);
        setUsedBytes(used);
        if (accountId) {
          setVaultSnapshot(accountId, {
            items: next,
            usedBytes: used,
            maxBytes,
            accountId,
          });
        }
        return next;
      });
    } catch (e) {
      const msg =
        e instanceof Error && e.message.trim()
          ? e.message.trim()
          : t("common.genericError");
      Alert.alert(t("vault.title"), msg);
    } finally {
      setSaving(false);
    }
  };

  const openDoc = async (doc: VaultDocument) => {
    if (!token) return;
    try {
      const dl = await getVaultDocumentDownload(token, doc.id);
      let local = dl.url;
      if (!dl.url.startsWith("file://") && !dl.url.startsWith("content://")) {
        const dir = `${FS.cacheDirectory}blyp-vault/`;
        const info = await FS.getInfoAsync(dir);
        if (!info.exists) {
          await FS.makeDirectoryAsync(dir, { intermediates: true });
        }
        const dest = `${dir}${doc.id}`;
        const saved = await FS.downloadAsync(dl.url, dest);
        local = saved.uri;
      }
      await openDocumentWithViewer(local, doc.name, doc.contentType);
    } catch {
      Alert.alert(t("vault.title"), t("vault.openFailed"));
    }
  };

  const rowMeta = (doc: VaultDocument) => {
    const parts: string[] = [];
    const created = String(doc.createdAt ?? "").trim();
    if (created) parts.push(formatTransactionDate(created));
    parts.push(formatFileSize(doc.sizeBytes));
    return parts.join(" · ");
  };

  const removeDoc = (doc: VaultDocument) => {
    Alert.alert(t("vault.deleteTitle"), t("vault.deleteMessage", { name: doc.name }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("vault.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          if (!token) return;
          void (async () => {
            try {
              await deleteVaultDocument(token, doc.id);
              setItems((prev) => {
                const next = prev.filter((d) => d.id !== doc.id);
                const used = next.reduce((a, d) => a + d.sizeBytes, 0);
                setUsedBytes(used);
                if (accountId) {
                  setVaultSnapshot(accountId, {
                    items: next,
                    usedBytes: used,
                    maxBytes,
                    accountId,
                  });
                }
                return next;
              });
            } catch {
              Alert.alert(t("vault.title"), t("common.genericError"));
            }
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          style={styles.headerBack}
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {t("vault.title")}
          </Text>
        </Pressable>
        {syncing ? (
          <ActivityIndicator color={colors.accent} size="small" />
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.quota}>
          {t("vault.quota", {
            used: formatFileSize(usedBytes),
            max: formatFileSize(maxBytes),
          })}
        </Text>
        <Text style={styles.sub}>{t("vault.intro")}</Text>

        {items.length === 0 && !syncing ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t("vault.emptyTitle")}</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(d) => d.id}
            contentContainerStyle={styles.list}
            style={{ flex: 1 }}
            renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => void openDoc(item)}
              onLongPress={() => removeDoc(item)}
              accessibilityRole="button"
              accessibilityLabel={item.name}
            >
              <View style={styles.rowIcon}>
                <Ionicons
                  name="document-text-outline"
                  size={22}
                  color={colors.accent}
                />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.rowMeta}>{rowMeta(item)}</Text>
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
        accessibilityLabel={t("vault.add")}
      >
        <Ionicons name="add" size={28} color={colors.accentOn} />
      </Pressable>

      <Modal
        visible={addOpen}
        transparent
        animationType={modalPresentation}
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
              <Text style={styles.sheetLabel}>{t("vault.addCamera")}</Text>
            </Pressable>
            <Pressable
              style={[styles.sheetRow, styles.sheetRowBorder]}
              onPress={() => void onPickFile()}
            >
              <Ionicons name="folder-open-outline" size={24} color={colors.text} />
              <Text style={styles.sheetLabel}>{t("vault.addFile")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={Boolean(pending)}
        transparent
        animationType={modalPresentation}
        onRequestClose={() => !saving && setPending(null)}
      >
        <View style={styles.nameModal}>
          <View style={styles.nameCard}>
            <Text style={styles.nameTitle}>{t("vault.nameTitle")}</Text>
            <TextInput
              style={styles.nameInput}
              value={docName}
              onChangeText={setDocName}
              placeholder={t("vault.namePlaceholder")}
              placeholderTextColor={colors.placeholder}
              autoFocus
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
                disabled={saving || docName.trim().length < 1}
              >
                {saving ? (
                  <ActivityIndicator color={colors.accentOn} />
                ) : (
                  <Text style={styles.nameBtnTextOn}>{t("vault.save")}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
