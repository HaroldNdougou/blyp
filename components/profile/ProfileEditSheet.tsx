import { createBlypDialogStyles } from "@/components/ui/blypDialogStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ApiError, updateMeProfile } from "@/lib/api/client";
import {
  cameroonPhoneSpacedPairsMaxLength,
  formatCameroonPhoneSpacedPairs,
  normalizeCameroonPhoneDigits,
} from "@/lib/format";
import { formatRegistrationFullName } from "@/lib/profile/parseRegistrationFullName";
import { modalPresentation } from "@/lib/perf/instantMotion";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { blypAlert } from "@/lib/ui/blypAlert";
import { showBlypActionFlash } from "@/lib/ui/blypActionFlash";

type Props = {
  visible: boolean;
  mode: "name" | "account";
  onClose: () => void;
};

export function ProfileEditSheet({ visible, mode, onClose }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const dialog = useMemo(() => createBlypDialogStyles(colors), [colors]);
  const { user, token, refreshUser } = useAuth();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !user) return;
    setFullName(
      formatRegistrationFullName(
        user.personalFirstName ?? user.firstName,
        user.personalLastName ?? user.lastName,
      ),
    );
    setPhone(user.phone.replace(/\D/g, "").slice(-9));
  }, [visible, user]);

  const onSave = async () => {
    if (!token || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      await updateMeProfile(token, {
        fullName: fullName.trim(),
        phone: mode === "account" ? phone : undefined,
      });
      await refreshUser();
      onClose();
      showBlypActionFlash(t("common.profileSavedFlash"));
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : t("common.saveFailed");
      blypAlert(title, msg);
    } finally {
      setSaving(false);
    }
  };

  const title =
    mode === "name"
      ? t("profile.editNameTitle")
      : t("profile.editAccountTitle");

  return (
    <Modal
      visible={visible}
      transparent
      animationType={modalPresentation}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={dialog.backdrop} onPress={onClose}>
        <View style={dialog.wrap} pointerEvents="box-none">
          <Pressable style={dialog.card} onPress={(e) => e.stopPropagation()}>
            <Text style={dialog.title}>{title}</Text>
            {mode === "account" ? (
              <>
                <Text style={dialog.message}>{t("profile.phone")}</Text>
                <TextInput
                  style={{
                    width: "100%",
                    minHeight: 48,
                    fontSize: 16,
                    fontWeight: "600",
                    color: colors.text,
                    backgroundColor: colors.inputBackground,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.inputBorder,
                    marginBottom: 14,
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                  }}
                  value={formatCameroonPhoneSpacedPairs(phone)}
                  onChangeText={(raw) =>
                    setPhone(normalizeCameroonPhoneDigits(raw).slice(0, 9))
                  }
                  keyboardType="phone-pad"
                  maxLength={cameroonPhoneSpacedPairsMaxLength(9)}
                  placeholder={t("register.phonePlaceholder")}
                  placeholderTextColor={colors.placeholder}
                />
              </>
            ) : null}
            <Text
              style={[
                dialog.message,
                { marginBottom: 8, textAlign: "left" as const },
              ]}
            >
              {t("profile.fullNameLabel")}
            </Text>
            <TextInput
              style={{
                width: "100%",
                minHeight: 48,
                fontSize: 16,
                fontWeight: "600",
                color: colors.text,
                backgroundColor: colors.inputBackground,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.inputBorder,
                marginBottom: 20,
                paddingHorizontal: 16,
                paddingVertical: 12,
              }}
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              maxLength={80}
              placeholder={t("register.fullNamePlaceholder")}
              placeholderTextColor={colors.placeholder}
            />
            <View style={dialog.actions}>
              <Pressable
                style={({ pressed }) => [
                  dialog.btnSecondary,
                  pressed && !saving && dialog.btnSecondaryPressed,
                ]}
                onPress={onClose}
                disabled={saving}
              >
                <Text style={dialog.btnSecondaryText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  dialog.btnPrimary,
                  pressed && !saving && dialog.btnPrimaryPressed,
                  saving && dialog.btnDestructiveDisabled,
                ]}
                onPress={() => void onSave()}
                disabled={saving || fullName.trim().length < 1}
              >
                {saving ? (
                  <ActivityIndicator color={colors.textInverse} size="small" />
                ) : (
                  <Text style={dialog.btnPrimaryText}>{t("common.save")}</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
