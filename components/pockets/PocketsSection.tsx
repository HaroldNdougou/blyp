import {
  CreatePocketSheet,
  PocketAmountSheet,
  pocketDisplayName,
} from "@/components/pockets/PocketSheets";
import { createPocketStyles } from "@/components/pockets/pocketStyles";
import type { createProfileStyles } from "@/components/profile/profileStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import type { Pocket } from "@/lib/api/types";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  hydratePockets,
  pocketsTotalFcfa,
  savingsPocketOf,
  syncPocketsFromNetwork,
  usePockets,
} from "@/lib/pockets/store";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { InteractionManager, Pressable, Text, View } from "react-native";

type ProfileStyles = ReturnType<typeof createProfileStyles>;

function openPocket(id: string) {
  router.push({ pathname: "/pocket/[id]", params: { id } });
}

/** Ligne « Mis de côté » sous le solde disponible (masquée si 0). */
export function PocketsSetAsideLine() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createPocketStyles(colors), [colors]);
  const pockets = usePockets(user?.phone);
  const total = pocketsTotalFcfa(pockets);
  if (total <= 0) return null;
  return (
    <Text style={styles.setAsideLine}>
      {t("pockets.setAsideTotal", { amount: formatFcfa(total) })}
    </Text>
  );
}

export function PocketsSection({ profileStyles }: { profileStyles: ProfileStyles }) {
  const { user, token } = useAuth();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createPocketStyles(colors), [colors]);
  const phone = user?.phone ?? "";
  const pockets = usePockets(phone);
  const [createOpen, setCreateOpen] = useState(false);
  const [setAsideOpen, setSetAsideOpen] = useState(false);

  useEffect(() => {
    if (!phone) return;
    void hydratePockets(phone);
    if (!token) return;
    const task = InteractionManager.runAfterInteractions(() => {
      void syncPocketsFromNetwork(token, phone).catch(() => {});
    });
    return () => task.cancel();
  }, [phone, token]);

  const savings = savingsPocketOf(pockets);
  const custom = useMemo(
    () => pockets.filter((p) => p.kind !== "savings"),
    [pockets],
  );
  const choices = useMemo(() => [savings, ...custom], [savings, custom]);

  const tile = (
    icon: React.ComponentProps<typeof Ionicons>["name"],
    label: string,
    onPress: () => void,
  ) => (
    <Pressable
      style={({ pressed }) => [
        profileStyles.actionBtn,
        pressed && profileStyles.actionBtnPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={profileStyles.actionIconWrap}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <Text
        style={profileStyles.actionLabel}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {label}
      </Text>
    </Pressable>
  );

  const row = (p: Pocket, first: boolean) => {
    const name = pocketDisplayName(p, t);
    const pending = p.id.startsWith("tmp-");
    return (
      <Pressable
        key={p.id}
        style={({ pressed }) => [
          styles.row,
          !first && styles.rowBorder,
          (pressed || pending) && styles.rowPressed,
        ]}
        onPress={() => openPocket(p.id)}
        disabled={pending}
        accessibilityRole="button"
        accessibilityLabel={t("pockets.openA11y", { name })}
      >
        <View style={styles.rowIcon}>
          {p.kind === "savings" ? (
            <Ionicons name="shield-checkmark" size={18} color={colors.accent} />
          ) : (
            <Text style={styles.rowIconText}>
              {(name.trim().charAt(0) || "?").toUpperCase()}
            </Text>
          )}
        </View>
        <View style={styles.rowTexts}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <Text
          style={[styles.rowAmount, p.balanceFcfa <= 0 && styles.rowAmountZero]}
        >
          {formatFcfa(p.balanceFcfa)} {t("common.fcfa")}
        </Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </Pressable>
    );
  };

  return (
    <>
      <View style={profileStyles.actionsRow}>
        {tile("add-circle-outline", t("pockets.actionCreate"), () =>
          setCreateOpen(true),
        )}
        {tile("shield-checkmark-outline", t("pockets.actionSavings"), () =>
          openPocket(savings.id),
        )}
        {tile("arrow-down-circle-outline", t("pockets.actionSetAside"), () =>
          setSetAsideOpen(true),
        )}
      </View>

      <Text style={profileStyles.sectionTitle}>{t("pockets.sectionTitle")}</Text>
      <View style={styles.listCard}>
        {row(savings, true)}
        {custom.map((p) => row(p, false))}
        {custom.length === 0 ? (
          <Text style={[styles.emptyHint, styles.rowBorder]}>
            {t("pockets.emptyHint")}
          </Text>
        ) : null}
      </View>

      <CreatePocketSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <PocketAmountSheet
        visible={setAsideOpen}
        onClose={() => setSetAsideOpen(false)}
        direction="in"
        pocket={null}
        choices={choices}
        onRequestCreate={() => {
          setSetAsideOpen(false);
          setCreateOpen(true);
        }}
      />
    </>
  );
}
