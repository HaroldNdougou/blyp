import { createKycStyles } from "@/components/kyc/kycStyles";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { pickKycPhotoFromCamera } from "@/lib/kyc/pickKycPhoto";
import { submitKycApplication } from "@/lib/kyc/submitKyc";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

type Shot = { uri: string; contentType: string };
type FlowStep = "front" | "back" | "selfie";

export function KycVerifyScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createKycStyles(colors), [colors]);
  const { user, token, refreshUser } = useAuth();

  const status = user?.kycStatus ?? "none";
  const canFlow = status !== "approved" && status !== "pending";

  const [step, setStep] = useState<FlowStep>("front");
  const [preview, setPreview] = useState<Shot | null>(null);
  const [front, setFront] = useState<Shot | null>(null);
  const [back, setBack] = useState<Shot | null>(null);
  const [selfie, setSelfie] = useState<Shot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraDismissed, setCameraDismissed] = useState(false);

  const cameraBusyRef = useRef(false);
  const autoStepRef = useRef<FlowStep | null>(null);

  const stepTitle =
    step === "front"
      ? t("kyc.stepFront")
      : step === "back"
        ? t("kyc.stepBack")
        : t("kyc.stepSelfie");

  const stepHint =
    step === "front"
      ? t("kyc.shotFrontHint")
      : step === "back"
        ? t("kyc.shotBackHint")
        : t("kyc.shotSelfieHint");

  const openCamera = useCallback(async () => {
    if (!canFlow || cameraBusyRef.current) return;
    cameraBusyRef.current = true;
    setCameraDismissed(false);
    setError(null);
    try {
      const picked = await pickKycPhotoFromCamera({
        selfie: step === "selfie",
      });
      if (!picked) {
        setCameraDismissed(true);
        Alert.alert(t("kyc.title"), t("kyc.cameraDenied"));
        return;
      }
      setPreview({
        uri: picked.uri,
        contentType: picked.contentType,
      });
    } finally {
      cameraBusyRef.current = false;
    }
  }, [canFlow, step]);

  useEffect(() => {
    if (!canFlow || preview || cameraDismissed) return;
    if (autoStepRef.current === step) return;
    autoStepRef.current = step;
    void openCamera();
  }, [canFlow, step, preview, cameraDismissed, openCamera]);

  const onRetake = () => {
    setPreview(null);
    setCameraDismissed(false);
    autoStepRef.current = null;
    void openCamera();
  };

  const onSubmit = async (selfieShot: Shot) => {
    if (!token || !front || !back || !selfieShot) return;
    setBusy(true);
    setError(null);
    try {
      const u = await submitKycApplication(token, {
        docType: "national_id",
        frontUri: front.uri,
        frontContentType: front.contentType,
        backUri: back.uri,
        backContentType: back.contentType,
        selfieUri: selfieShot.uri,
        selfieContentType: selfieShot.contentType,
      });
      await refreshUser();
      if (u.kycStatus === "approved") {
        Alert.alert(t("kyc.title"), t("kyc.approvedMessage"));
      } else {
        Alert.alert(t("kyc.title"), t("kyc.pendingMessage"));
      }
      router.back();
    } catch (e) {
      const msg =
        e instanceof Error && e.message.trim()
          ? e.message.trim()
          : t("common.genericError");
      setError(msg);
      setBusy(false);
    }
  };

  const onConfirmPreview = () => {
    if (!preview) return;
    if (step === "front") {
      setFront(preview);
      setPreview(null);
      setCameraDismissed(false);
      autoStepRef.current = null;
      setStep("back");
      return;
    }
    if (step === "back") {
      setBack(preview);
      setPreview(null);
      setCameraDismissed(false);
      autoStepRef.current = null;
      setStep("selfie");
      return;
    }
    const selfieShot = preview;
    setSelfie(selfieShot);
    setPreview(null);
    void onSubmit(selfieShot);
  };

  const statusBanner =
    status === "approved"
      ? styles.statusBanner
      : status === "pending"
        ? [styles.statusBanner, styles.statusBannerPending]
        : status === "rejected"
          ? [styles.statusBanner, styles.statusBannerRejected]
          : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{t("kyc.title")}</Text>
      </View>

      <View
        style={[
          styles.flowBody,
          { paddingBottom: 24 + Math.max(insets.bottom, 8) },
        ]}
      >
        {statusBanner ? (
          <View style={statusBanner}>
            <Text style={styles.statusText}>
              {status === "approved"
                ? t("kyc.statusApproved")
                : status === "pending"
                  ? t("kyc.statusPending")
                  : status === "rejected"
                    ? t("kyc.statusRejected")
                    : ""}
            </Text>
          </View>
        ) : null}

        {canFlow ? (
          <>
            <Text style={styles.flowStepTitle}>{stepTitle}</Text>
            <Text style={styles.flowStepHint}>{stepHint}</Text>

            {preview ? (
              <View style={styles.previewWrap}>
                <Image
                  source={{ uri: preview.uri }}
                  style={styles.previewImage}
                  contentFit="contain"
                />
                <View style={styles.previewActions}>
                  <Pressable
                    style={styles.secondaryBtn}
                    onPress={onRetake}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t("kyc.shotRetake")}
                  >
                    <Text style={styles.secondaryBtnText}>
                      {t("kyc.shotRetake")}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.primaryBtn,
                      styles.primaryBtnInline,
                      busy && styles.primaryBtnDisabled,
                    ]}
                    onPress={onConfirmPreview}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t("common.validate")}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.accentOn} />
                    ) : (
                      <Text style={styles.primaryBtnText}>
                        {t("common.validate")}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : cameraDismissed ? (
              <Pressable
                style={styles.primaryBtn}
                onPress={() => {
                  autoStepRef.current = null;
                  void openCamera();
                }}
                accessibilityRole="button"
                accessibilityLabel={t("kyc.openCamera")}
              >
                <Text style={styles.primaryBtnText}>{t("kyc.openCamera")}</Text>
              </Pressable>
            ) : (
              <View style={styles.flowWaiting}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={styles.flowStepHint}>{t("kyc.openingCamera")}</Text>
              </View>
            )}

            {error ? <Text style={styles.errorLine}>{error}</Text> : null}
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
