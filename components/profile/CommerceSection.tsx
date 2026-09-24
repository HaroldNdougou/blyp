import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/format";
import type { CommerceCategory } from "@/lib/api/types";
import { createProfileStyles } from "@/components/profile/profileStyles";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const CATEGORIES: CommerceCategory[] = ["taxi", "shop", "other"];

/** Chaque mot commence par une majuscule (saisie fluide). */
function capitalizeCommerceName(raw: string): string {
  return raw.replace(/\S+/g, (word) => {
    const first = word.charAt(0).toLocaleUpperCase();
    const rest = word.slice(1);
    return first + rest;
  });
}

type Props = {
  styles: ReturnType<typeof createProfileStyles>;
  onContextChanged?: (next: "personal" | "commerce") => void;
};

/**
 * Liste + création commerce — switch cache-first (AuthContext).
 */
export function CommerceSection({ styles, onContextChanged }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, setActiveContext, createCommerce } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<CommerceCategory>("taxi");
  const [creating, setCreating] = useState(false);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [keyboardLift, setKeyboardLift] = useState(0);

  useEffect(() => {
    if (!sheetOpen) {
      setKeyboardLift(0);
      return;
    }
    const showEvt =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) => {
      setKeyboardLift(e.endCoordinates?.height ?? 0);
    });
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardLift(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [sheetOpen]);

  const commerces = user?.commerces ?? [];
  const active = user?.activeContext;

  const categoryLabel = useCallback(
    (c: string) => {
      if (c === "taxi") return t("commerce.categoryTaxi");
      if (c === "shop") return t("commerce.categoryShop");
      return t("commerce.categoryOther");
    },
    [t],
  );

  const switchTo = useCallback(
    async (
      input: { type: "personal" } | { type: "commerce"; commerceId: string },
    ) => {
      const key =
        input.type === "personal" ? "personal" : input.commerceId;
      if (busyId) return;
      if (
        input.type === "personal" &&
        active?.type === "personal"
      ) {
        return;
      }
      if (
        input.type === "commerce" &&
        active?.type === "commerce" &&
        active.commerceId === input.commerceId
      ) {
        return;
      }
      setBusyId(key);
      try {
        await setActiveContext(input);
        onContextChanged?.(input.type);
      } catch {
        setErrorLine(t("commerce.switchFailed"));
      } finally {
        setBusyId(null);
      }
    },
    [active, busyId, onContextChanged, setActiveContext, t],
  );

  const onCreate = useCallback(async () => {
    const n = name.trim();
    if (n.length < 2) {
      setErrorLine(t("commerce.nameTooShort"));
      return;
    }
    setCreating(true);
    setErrorLine(null);
    try {
      await createCommerce({ name: n, category });
      setSheetOpen(false);
      setName("");
      setCategory("taxi");
      onContextChanged?.("commerce");
    } catch (e) {
      const { ApiError } = await import("@/lib/api/errors");
      const msg =
        e instanceof ApiError && e.message.trim()
          ? e.message
          : t("commerce.createFailed");
      setErrorLine(msg);
    } finally {
      setCreating(false);
    }
  }, [name, category, createCommerce, onContextChanged, t]);

  const chips = useMemo(
    () =>
      CATEGORIES.map((c) => (
        <Pressable
          key={c}
          onPress={() => setCategory(c)}
          style={[
            styles.commerceChip,
            category === c && styles.commerceChipOn,
          ]}
        >
          <Text
            style={[
              styles.commerceChipText,
              category === c && styles.commerceChipTextOn,
            ]}
          >
            {categoryLabel(c)}
          </Text>
        </Pressable>
      )),
    [category, categoryLabel, styles],
  );

  return (
    <>
      <Text style={styles.sectionTitle}>{t("profile.sectionCommerces")}</Text>
      <View style={styles.sectionCard}>
        <Pressable
          style={({ pressed }) => [
            styles.commerceRow,
            commerces.length > 0 && styles.rowBorder,
            pressed && styles.commerceRowPressed,
            active?.type === "personal" && styles.commerceRowActive,
          ]}
          onPress={() => {
            void switchTo({ type: "personal" });
          }}
          disabled={busyId != null}
        >
          <View style={styles.commerceTexts}>
            <Text style={styles.commerceTitle}>{t("commerce.personal")}</Text>
            <Text style={styles.commerceMeta}>
              {active?.type === "personal"
                ? t("commerce.active")
                : t("commerce.open")}
            </Text>
          </View>
          {busyId === "personal" ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : active?.type === "personal" ? (
            <Text style={styles.commerceActiveMark}>{t("commerce.active")}</Text>
          ) : null}
        </Pressable>

        {commerces.map((c, idx) => {
          const isActive =
            active?.type === "commerce" && active.commerceId === c.id;
          return (
            <Pressable
              key={c.id}
              style={({ pressed }) => [
                styles.commerceRow,
                idx < commerces.length - 1 && styles.rowBorder,
                pressed && styles.commerceRowPressed,
                isActive && styles.commerceRowActive,
              ]}
              onPress={() => {
                void switchTo({ type: "commerce", commerceId: c.id });
              }}
              disabled={busyId != null}
            >
              <View style={styles.commerceTexts}>
                <Text style={styles.commerceTitle} numberOfLines={1}>
                  {c.name}
                </Text>
                <Text style={styles.commerceMeta} numberOfLines={1}>
                  {categoryLabel(String(c.category))} ·{" "}
                  {formatFcfa(c.balanceFcfa)}
                </Text>
              </View>
              {busyId === c.id ? (
                <ActivityIndicator color={colors.accent} size="small" />
              ) : isActive ? (
                <Text style={styles.commerceActiveMark}>
                  {t("commerce.active")}
                </Text>
              ) : null}
            </Pressable>
          );
        })}

        {commerces.length === 0 ? (
          <Text style={styles.commerceEmpty}>{t("commerce.emptyHint")}</Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.commerceCreateBtn,
            pressed && styles.commerceCreateBtnPressed,
          ]}
          onPress={() => {
            setErrorLine(null);
            setSheetOpen(true);
          }}
        >
          <Text style={styles.commerceCreateBtnText}>{t("commerce.create")}</Text>
        </Pressable>
      </View>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!creating) setSheetOpen(false);
        }}
      >
        <View style={styles.commerceModalRoot}>
          <Pressable
            style={styles.commerceModalBackdrop}
            onPress={() => {
              if (!creating) setSheetOpen(false);
            }}
          />
          <View
            style={[
              styles.commerceModalCard,
              {
                marginBottom: keyboardLift,
                paddingBottom: Math.max(insets.bottom, 16) + 12,
              },
            ]}
          >
            <Text style={styles.commerceModalTitle}>
              {t("commerce.createTitle")}
            </Text>
            <Text style={styles.commerceModalLead}>
              {t("commerce.createLead")}
            </Text>
            <Text style={styles.commerceModalLabel}>
              {t("commerce.nameLabel")}
            </Text>
            <TextInput
              style={styles.commerceModalInput}
              value={name}
              onChangeText={(text) => setName(capitalizeCommerceName(text))}
              placeholder={t("commerce.namePlaceholder")}
              placeholderTextColor={colors.placeholder}
              autoFocus
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={48}
              editable={!creating}
            />
            <Text style={styles.commerceModalLabel}>
              {t("commerce.categoryLabel")}
            </Text>
            <View style={styles.commerceChipRow}>{chips}</View>
            {errorLine ? (
              <Text style={styles.commerceModalError}>{errorLine}</Text>
            ) : null}
            <View style={styles.commerceModalActions}>
              <Pressable
                onPress={() => {
                  if (!creating) setSheetOpen(false);
                }}
                style={styles.commerceModalBtnHit}
                disabled={creating}
              >
                <Text style={styles.commerceModalBtnCancel}>
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  void onCreate();
                }}
                style={styles.commerceModalBtnHit}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <Text style={styles.commerceModalBtnOk}>
                    {t("commerce.createCta")}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
