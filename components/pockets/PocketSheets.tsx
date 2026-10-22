import { createPocketStyles, type PocketStyles } from "@/components/pockets/pocketStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { modalPresentation } from "@/lib/perf/instantMotion";
import { ApiError } from "@/lib/api/errors";
import type { Pocket } from "@/lib/api/types";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  createPocketOptimistic,
  movePocketFundsOptimistic,
  renamePocketOptimistic,
} from "@/lib/pockets/actions";
import type { TFunction } from "i18next";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MAX_AMOUNT = 999_999;
const QUICK_AMOUNTS = [1_000, 5_000, 10_000, 25_000] as const;

export function pocketDisplayName(p: Pocket, t: TFunction): string {
  return p.kind === "savings" ? t("pockets.savingsName") : p.name;
}

export function showPocketError(t: TFunction, e: unknown) {
  const msg =
    e instanceof ApiError && e.message ? e.message : t("common.genericError");
  Alert.alert(t("pockets.errorTitle"), msg);
}

function useKeyboardLift(open: boolean): number {
  const [lift, setLift] = useState(0);
  useEffect(() => {
    if (!open) {
      setLift(0);
      return;
    }
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const a = Keyboard.addListener(showEvt, (e) =>
      setLift(e.endCoordinates?.height ?? 0),
    );
    const b = Keyboard.addListener(hideEvt, () => setLift(0));
    return () => {
      a.remove();
      b.remove();
    };
  }, [open]);
  return lift;
}

function parseAmount(raw: string): number {
  const n = parseInt(raw.replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function SheetFrame({
  visible,
  onClose,
  styles,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  styles: PocketStyles;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const lift = useKeyboardLift(visible);
  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.sheetRoot}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View
          style={[
            styles.sheetCard,
            {
              marginBottom: lift,
              paddingBottom: Math.max(insets.bottom, 16) + 12,
            },
          ]}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}

function AmountField({
  styles,
  value,
  onChange,
  max,
  hint,
  autoFocus,
}: {
  styles: PocketStyles;
  value: string;
  onChange: (v: string) => void;
  max: number;
  hint: string;
  autoFocus?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const amount = parseAmount(value);
  const quick = QUICK_AMOUNTS.filter((a) => a <= max);
  return (
    <>
      <View style={styles.amountWrap}>
        <TextInput
          style={styles.amountInput}
          value={amount > 0 ? formatFcfa(amount) : ""}
          onChangeText={(txt) => {
            const n = Math.min(parseAmount(txt), MAX_AMOUNT);
            onChange(n > 0 ? String(n) : "");
          }}
          placeholder="0"
          placeholderTextColor={colors.placeholder}
          keyboardType="number-pad"
          autoFocus={autoFocus}
          maxLength={9}
          accessibilityLabel={t("pockets.amountLabel")}
        />
        <Text style={styles.amountCurrency}>{t("common.fcfa")}</Text>
      </View>
      <Text style={styles.hint}>{hint}</Text>
      {max > 0 ? (
        <View style={[styles.chipRow, { marginTop: 10 }]}>
          {quick.map((a) => {
            const on = amount === a;
            return (
              <Pressable
                key={a}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => onChange(String(a))}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>
                  {formatFcfa(a)}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            style={[styles.chip, amount === max && styles.chipOn]}
            onPress={() => onChange(String(Math.min(max, MAX_AMOUNT)))}
          >
            <Text
              style={[styles.chipText, amount === max && styles.chipTextOn]}
            >
              {t("pockets.all")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

function PrimaryButton({
  styles,
  label,
  disabled,
  onPress,
}: {
  styles: PocketStyles;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.primaryBtn,
        disabled && styles.primaryBtnDisabled,
        pressed && !disabled && styles.primaryBtnPressed,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function usePocketCtx() {
  const { user, token, updateBalance } = useAuth();
  return {
    token,
    phone: user?.phone ?? "",
    balanceFcfa: user?.balanceFcfa ?? 0,
    updateBalance,
  };
}

const SUGGESTION_KEYS = [
  "entrusted",
  "contribution",
  "school",
  "rent",
  "project",
  "emergency",
] as const;

export function CreatePocketSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createPocketStyles(colors), [colors]);
  const ctx = usePocketCtx();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName("");
      setAmount("");
      setError(null);
    }
  }, [visible]);

  const submit = () => {
    const n = name.trim();
    const a = parseAmount(amount);
    if (!n) {
      setError(t("pockets.nameRequired"));
      return;
    }
    if (a > ctx.balanceFcfa) {
      setError(t("pockets.amountTooHigh"));
      return;
    }
    if (!ctx.token || !ctx.phone) return;
    onClose();
    void createPocketOptimistic(
      { ...ctx, token: ctx.token },
      n,
      a,
    ).catch((e) => showPocketError(t, e));
  };

  return (
    <SheetFrame visible={visible} onClose={onClose} styles={styles}>
      <Text style={styles.sheetTitle}>{t("pockets.createTitle")}</Text>
      <Text style={styles.sheetLead}>{t("pockets.createLead")}</Text>
      <Text style={styles.sheetLabel}>{t("pockets.nameLabel")}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(v) => {
          setName(v.slice(0, 40));
          setError(null);
        }}
        placeholder={t("pockets.namePlaceholder")}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="sentences"
        autoFocus
        maxLength={40}
        returnKeyType="done"
        accessibilityLabel={t("pockets.nameLabel")}
      />
      <View style={[styles.chipRow, { marginTop: 10 }]}>
        {SUGGESTION_KEYS.map((k) => {
          const label = t(`pockets.suggestions.${k}`);
          const on = name.trim() === label;
          return (
            <Pressable
              key={k}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => {
                setName(label);
                setError(null);
              }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.sheetLabel}>{t("pockets.initialAmountLabel")}</Text>
      <AmountField
        styles={styles}
        value={amount}
        onChange={(v) => {
          setAmount(v);
          setError(null);
        }}
        max={ctx.balanceFcfa}
        hint={t("pockets.availableHint", { amount: formatFcfa(ctx.balanceFcfa) })}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        styles={styles}
        label={t("pockets.create")}
        disabled={!name.trim()}
        onPress={submit}
      />
    </SheetFrame>
  );
}

/**
 * Ranger (in) / retirer (out). Sans `pocket` → choix de la poche (puces).
 */
export function PocketAmountSheet({
  visible,
  onClose,
  direction,
  pocket,
  choices,
  onRequestCreate,
}: {
  visible: boolean;
  onClose: () => void;
  direction: "in" | "out";
  pocket: Pocket | null;
  choices?: Pocket[];
  onRequestCreate?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createPocketStyles(colors), [colors]);
  const ctx = usePocketCtx();
  const [amount, setAmount] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  useEffect(() => {
    if (!visible) return;
    setAmount("");
    setError(null);
    setPickedId(pocket?.id ?? choicesRef.current?.[0]?.id ?? null);
  }, [visible, pocket?.id]);

  const target =
    pocket ?? choices?.find((p) => p.id === pickedId) ?? null;
  const max = direction === "in" ? ctx.balanceFcfa : (target?.balanceFcfa ?? 0);
  const a = parseAmount(amount);

  const submit = () => {
    if (!target) return;
    if (a <= 0) {
      setError(t("pockets.amountInvalid"));
      return;
    }
    if (a > max) {
      setError(
        direction === "in"
          ? t("pockets.amountTooHigh")
          : t("pockets.amountTooHighPocket"),
      );
      return;
    }
    if (!ctx.token || !ctx.phone) return;
    onClose();
    void movePocketFundsOptimistic(
      { ...ctx, token: ctx.token },
      target,
      direction,
      a,
    ).catch((e) => showPocketError(t, e));
  };

  const title = pocket
    ? direction === "in"
      ? t("pockets.addTitle", { name: pocketDisplayName(pocket, t) })
      : t("pockets.withdrawTitle", { name: pocketDisplayName(pocket, t) })
    : t("pockets.setAsideTitle");

  return (
    <SheetFrame visible={visible} onClose={onClose} styles={styles}>
      <Text style={styles.sheetTitle} numberOfLines={2}>
        {title}
      </Text>
      {!pocket && choices ? (
        <>
          <Text style={styles.sheetLabel}>{t("pockets.chooseLabel")}</Text>
          <View style={styles.chipRow}>
            {choices.map((p) => {
              const on = p.id === pickedId;
              return (
                <Pressable
                  key={p.id}
                  style={[styles.chip, on && styles.chipOn]}
                  onPress={() => setPickedId(p.id)}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>
                    {pocketDisplayName(p, t)}
                  </Text>
                </Pressable>
              );
            })}
            {onRequestCreate ? (
              <Pressable style={styles.chip} onPress={onRequestCreate}>
                <Text style={[styles.chipText, styles.chipTextOn]}>
                  {t("pockets.newPocketChip")}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
      <Text style={styles.sheetLabel}>{t("pockets.amountLabel")}</Text>
      <AmountField
        styles={styles}
        value={amount}
        onChange={(v) => {
          setAmount(v);
          setError(null);
        }}
        max={max}
        autoFocus={Boolean(pocket)}
        hint={
          direction === "in"
            ? t("pockets.availableHint", { amount: formatFcfa(ctx.balanceFcfa) })
            : t("pockets.inPocketHint", { amount: formatFcfa(max) })
        }
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        styles={styles}
        label={direction === "in" ? t("pockets.add") : t("pockets.withdraw")}
        disabled={!target || a <= 0}
        onPress={submit}
      />
    </SheetFrame>
  );
}

export function RenamePocketSheet({
  visible,
  onClose,
  pocket,
}: {
  visible: boolean;
  onClose: () => void;
  pocket: Pocket;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useMemo(() => createPocketStyles(colors), [colors]);
  const ctx = usePocketCtx();
  const [name, setName] = useState(pocket.name);

  useEffect(() => {
    if (visible) setName(pocket.name);
  }, [visible, pocket.name]);

  const submit = () => {
    const n = name.trim();
    if (!n || !ctx.token) return;
    onClose();
    if (n === pocket.name) return;
    void renamePocketOptimistic(
      { token: ctx.token, phone: ctx.phone },
      pocket,
      n,
    ).catch((e) => showPocketError(t, e));
  };

  return (
    <SheetFrame visible={visible} onClose={onClose} styles={styles}>
      <Text style={styles.sheetTitle}>{t("pockets.renameTitle")}</Text>
      <Text style={styles.sheetLabel}>{t("pockets.nameLabel")}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={(v) => setName(v.slice(0, 40))}
        placeholder={t("pockets.namePlaceholder")}
        placeholderTextColor={colors.placeholder}
        autoFocus
        maxLength={40}
        returnKeyType="done"
        onSubmitEditing={submit}
        accessibilityLabel={t("pockets.nameLabel")}
      />
      <PrimaryButton
        styles={styles}
        label={t("pockets.save")}
        disabled={!name.trim()}
        onPress={submit}
      />
    </SheetFrame>
  );
}
