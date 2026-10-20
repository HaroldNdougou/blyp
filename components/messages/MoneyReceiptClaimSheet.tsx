import { MoneyReceiptStampPreview } from "@/components/messages/MoneyReceiptStampPreview";
import { SignatureScratchPad } from "@/components/messages/SignatureScratchPad";
import { useTheme } from "@/contexts/ThemeContext";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  loadCommerceStamp,
  saveCommerceStamp,
} from "@/lib/receipts/commerceStampStore";
import type {
  CommerceStamp,
  CommerceStampColor,
  CommerceStampShape,
} from "@/lib/receipts/commerceStampTypes";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export type MoneyReceiptClaimContext = {
  transferId: string;
  amountFcfa: number;
  defaultClientName: string;
};

type Props = {
  visible: boolean;
  context: MoneyReceiptClaimContext | null;
  userId: string;
  commerceId: string | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (draft: {
    clientName: string;
    reason: string;
    stamp: CommerceStamp;
  }) => void;
};

export function MoneyReceiptClaimSheet({
  visible,
  context,
  userId,
  commerceId,
  submitting,
  onClose,
  onSubmit,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [loadingStamp, setLoadingStamp] = useState(false);
  const [stamp, setStamp] = useState<CommerceStamp | null>(null);
  const [stampMode, setStampMode] = useState(false);
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [shape, setShape] = useState<CommerceStampShape>("circle");
  const [color, setColor] = useState<CommerceStampColor>("red");
  const [clientName, setClientName] = useState("");
  const [reason, setReason] = useState("");
  const [signed, setSigned] = useState(false);
  const [savingStamp, setSavingStamp] = useState(false);

  const resetForm = useCallback(() => {
    setClientName(context?.defaultClientName?.trim() ?? "");
    setReason("");
    setSigned(false);
    setLine1("");
    setLine2("");
    setShape("circle");
    setColor("red");
    setStampMode(false);
  }, [context?.defaultClientName]);

  useEffect(() => {
    if (!visible || !context || !userId) return;
    resetForm();
    setLoadingStamp(true);
    void loadCommerceStamp(userId, commerceId)
      .then((s) => {
        setStamp(s);
        if (!s) setStampMode(true);
      })
      .finally(() => setLoadingStamp(false));
  }, [visible, context?.transferId, userId, commerceId, resetForm]);

  const previewStamp: CommerceStamp = stamp ?? {
    line1: line1.trim() || "—",
    line2: line2.trim(),
    shape,
    color,
    updatedAt: "",
  };

  const saveStamp = async () => {
    if (!line1.trim()) return;
    setSavingStamp(true);
    try {
      const res = await saveCommerceStamp(userId, commerceId, {
        line1,
        line2,
        shape,
        color,
        updatedAt: new Date().toISOString(),
      });
      if (!res.ok) {
        Alert.alert(
          t("moneyReceipt.claimTitle"),
          t("moneyReceipt.stampDuplicate"),
        );
        return;
      }
      setStamp(res.stamp);
      setStampMode(false);
    } finally {
      setSavingStamp(false);
    }
  };

  const canSubmitReceipt =
    Boolean(stamp) &&
    clientName.trim().length > 0 &&
    reason.trim().length > 0 &&
    signed &&
    !submitting;

  const chip = (
    label: string,
    on: boolean,
    onPress: () => void,
  ) => (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: on ? colors.accent : colors.borderLight,
        backgroundColor: on ? colors.depositHighlightBackground : colors.surfaceMuted,
      }}
    >
      <Text
        style={{
          fontSize: 13,
          fontWeight: "600",
          color: on ? colors.accent : colors.textSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: colors.overlay }}
        onPress={onClose}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{
          maxHeight: "88%",
          backgroundColor: colors.modal,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 14,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.borderLight,
          }}
        >
          <Text
            style={{
              flex: 1,
              fontSize: 17,
              fontWeight: "700",
              color: colors.text,
            }}
          >
            {stampMode
              ? t("moneyReceipt.stampCreateTitle")
              : t("moneyReceipt.claimTitle")}
          </Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
            <Text style={{ fontSize: 16, color: colors.textMuted }}>
              {t("common.cancel")}
            </Text>
          </Pressable>
        </View>

        {loadingStamp ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 20, gap: 14 }}
          >
            {stampMode ? (
              <>
                <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textMuted }}>
                  {t("moneyReceipt.stampCreateLead")}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary }}>
                  {t("moneyReceipt.stampLine1")}
                </Text>
                <TextInput
                  value={line1}
                  onChangeText={setLine1}
                  placeholder={t("moneyReceipt.stampLine1Placeholder")}
                  placeholderTextColor={colors.placeholder}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary }}>
                  {t("moneyReceipt.stampLine2")}
                </Text>
                <TextInput
                  value={line2}
                  onChangeText={setLine2}
                  placeholder={t("moneyReceipt.stampLine2Placeholder")}
                  placeholderTextColor={colors.placeholder}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {chip(t("moneyReceipt.stampShapeCircle"), shape === "circle", () =>
                    setShape("circle"),
                  )}
                  {chip(t("moneyReceipt.stampShapeLine"), shape === "line", () =>
                    setShape("line"),
                  )}
                  {chip(t("moneyReceipt.stampColorRed"), color === "red", () =>
                    setColor("red"),
                  )}
                  {chip(t("moneyReceipt.stampColorBlue"), color === "blue", () =>
                    setColor("blue"),
                  )}
                </View>
                <View style={{ alignItems: "center", marginVertical: 8 }}>
                  <MoneyReceiptStampPreview stamp={previewStamp} />
                </View>
                <Pressable
                  onPress={() => void saveStamp()}
                  disabled={!line1.trim() || savingStamp}
                  style={{
                    backgroundColor: colors.accent,
                    borderRadius: 14,
                    paddingVertical: 14,
                    alignItems: "center",
                    opacity: !line1.trim() || savingStamp ? 0.5 : 1,
                  }}
                >
                  {savingStamp ? (
                    <ActivityIndicator color={colors.accentOn} />
                  ) : (
                    <Text
                      style={{
                        color: colors.accentOn,
                        fontSize: 16,
                        fontWeight: "700",
                      }}
                    >
                      {t("moneyReceipt.stampSave")}
                    </Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textMuted }}>
                  {t("moneyReceipt.claimLead")}
                </Text>
                {stamp ? (
                  <View style={{ alignItems: "flex-start" }}>
                    <MoneyReceiptStampPreview stamp={stamp} compact />
                    <Pressable
                      onPress={() => {
                        setLine1(stamp.line1);
                        setLine2(stamp.line2);
                        setShape(stamp.shape);
                        setColor(stamp.color);
                        setStampMode(true);
                      }}
                      hitSlop={8}
                      style={{ marginTop: 6 }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.accent }}>
                        {t("moneyReceipt.stampEdit")}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary }}>
                  {t("moneyReceipt.clientName")}
                </Text>
                <TextInput
                  value={clientName}
                  onChangeText={setClientName}
                  placeholder={t("moneyReceipt.clientNamePlaceholder")}
                  placeholderTextColor={colors.placeholder}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary }}>
                  {t("moneyReceipt.amount")}
                </Text>
                <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>
                  {formatFcfa(context?.amountFcfa ?? 0)}
                </Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary }}>
                  {t("moneyReceipt.reason")}
                </Text>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  placeholder={t("moneyReceipt.reasonPlaceholder")}
                  placeholderTextColor={colors.placeholder}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                  }}
                />
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textSecondary }}>
                  {t("moneyReceipt.signature")}
                </Text>
                <SignatureScratchPad onSignedChange={setSigned} />
                <Pressable
                  onPress={() => {
                    if (!stamp || !canSubmitReceipt) return;
                    onSubmit({
                      clientName: clientName.trim(),
                      reason: reason.trim(),
                      stamp,
                    });
                  }}
                  disabled={!canSubmitReceipt}
                  style={{
                    backgroundColor: colors.accent,
                    borderRadius: 14,
                    paddingVertical: 14,
                    alignItems: "center",
                    marginTop: 4,
                    opacity: canSubmitReceipt ? 1 : 0.5,
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color={colors.accentOn} />
                  ) : (
                    <Text
                      style={{
                        color: colors.accentOn,
                        fontSize: 16,
                        fontWeight: "700",
                      }}
                    >
                      {t("moneyReceipt.submit")}
                    </Text>
                  )}
                </Pressable>
              </>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}
