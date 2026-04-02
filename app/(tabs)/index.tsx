import { useAuth } from "@/contexts/AuthContext";
import { ApiError, pay as apiPay } from "@/lib/api/client";
import { USE_MOCK_API } from "@/lib/config";
import {
  formatCameroonPhoneDisplay,
  formatFcfa,
  normalizeCameroonPhoneDigits,
} from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView as SafeModalArea, useSafeAreaInsets } from "react-native-safe-area-context";

/** Vert identité Blyp */
const BLYP_GREEN = "#5dc705";
const ACCENT = BLYP_GREEN;

/** Même principe que `app/deposit.tsx` : feuille sous la barre de statut. */
const REG_SHEET_EXTRA_TOP = 36;

export default function Index() {
  const {
    user,
    token,
    isLoading: authLoading,
    requestOtp,
    verifyAndSignIn,
    refreshUser,
  } = useAuth();
  const [amount, setAmount] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<'IDLE' | 'SENDING' | 'SUCCESS'>('IDLE');
  const balance = user?.balanceFcfa ?? 0;
  const [registerInviteVisible, setRegisterInviteVisible] = useState(false);
  const [welcomePhone, setWelcomePhone] = useState("");
  const [welcomeOtp, setWelcomeOtp] = useState("");
  const [welcomeStep, setWelcomeStep] = useState<"phone" | "otp">("phone");
  const [authOtpSending, setAuthOtpSending] = useState(false);
  const [authVerifySending, setAuthVerifySending] = useState(false);
  const inviteBootstrapped = useRef(false);
  const regPhoneInputRef = useRef<TextInput>(null);
  const regOtpInputRef = useRef<TextInput>(null);
  const regInsets = useSafeAreaInsets();
  const regSheetTop = regInsets.top + REG_SHEET_EXTRA_TOP;

  const showRegisterOverlay = !user && registerInviteVisible;

  useEffect(() => {
    if (authLoading) return;
    if (!user && !inviteBootstrapped.current) {
      inviteBootstrapped.current = true;
      setRegisterInviteVisible(true);
    }
  }, [authLoading, user]);

  useEffect(() => {
    if (user) setRegisterInviteVisible(false);
  }, [user]);

  useEffect(() => {
    if (registerInviteVisible) {
      setWelcomeStep("phone");
      setWelcomeOtp("");
    } else {
      setWelcomeStep("phone");
      setWelcomeOtp("");
      setWelcomePhone("");
    }
  }, [registerInviteVisible]);

  /** Focus + clavier après ouverture du modal / changement d’étape (délai Android = fin animation). */
  useEffect(() => {
    if (!showRegisterOverlay) return;
    const delay = Platform.OS === "android" ? 450 : 120;
    const t = setTimeout(() => {
      if (welcomeStep === "phone") {
        regPhoneInputRef.current?.focus();
      } else {
        regOtpInputRef.current?.focus();
      }
    }, delay);
    return () => clearTimeout(t);
  }, [showRegisterOverlay, welcomeStep]);

  const OTP_LEN = 6;

  const detectedDriver = {
    name: "Taxi Mohamadou",
    phone: "698 25 68 96",
    avatar: null,
  };

  const handlePay = async () => {
    const n = parseInt(amount, 10);
    if (!amount || !Number.isFinite(n) || n <= 0 || paymentStatus === "SENDING")
      return;
    if (!token) {
      Alert.alert(
        "Connexion",
        "Créez un compte ou connectez-vous pour payer.",
      );
      return;
    }
    Keyboard.dismiss();
    setPaymentStatus("SENDING");
    try {
      await apiPay(
        token,
        n,
        detectedDriver.name,
        detectedDriver.phone.replace(/\s/g, "") || null,
      );
      await refreshUser();
      setPaymentStatus("SUCCESS");
    } catch (e) {
      Alert.alert(
        "Paiement",
        e instanceof ApiError ? e.message : "Une erreur est survenue.",
      );
      setPaymentStatus("IDLE");
    }
  };

  if (paymentStatus === 'SUCCESS') {
    return (
      <View style={styles.successContainer}>
        <Text style={styles.successEmoji}>✅</Text>
        <Text style={styles.successText}>Payé !</Text>
        <Text style={styles.successSub}>
          {formatFcfa(parseInt(amount, 10) || 0)} FCFA versé à {detectedDriver.name}
        </Text>
        <Pressable
          style={styles.resetButton}
          onPress={() => { setAmount(""); setPaymentStatus('IDLE'); }}
        >
          <Text style={styles.resetButtonText}>Nouvelle transaction</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: "#ffffff" }}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={{ flex: 1 }}>
          <Stack.Screen options={{ headerShown: false }} />
          <SafeAreaView style={styles.safeArea}>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.balanceWrap}>
                <View style={styles.balanceAmountRow}>
                  <Text style={styles.balanceLabel}>Solde:</Text>
                  <Text style={styles.balanceAmountNum}>
                    {formatFcfa(balance)}
                  </Text>
                  <Text style={styles.balanceCurrency}>FCFA</Text>
                </View>
                <View style={styles.balanceReassuranceRow}>
                  <View style={styles.balanceReassuranceInner}>
                    <Ionicons
                      name="lock-closed"
                      size={12}
                      color={ACCENT}
                      style={styles.balanceReassuranceIcon}
                    />
                    <Text style={styles.balanceReassurance}>
                      Votre argent reste sur votre compte, protégé et utilisable uniquement par vous.
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={({ pressed }) => [
                    styles.createAccountBtn,
                    styles.rechargeBtn,
                    pressed && styles.createAccountBtnPressed,
                  ]}
                  onPress={() => router.push("/deposit")}
                  accessibilityRole="button"
                  accessibilityLabel="Recharger le compte"
                >
                  <View style={styles.createAccountBtnIcon}>
                    <Ionicons name="wallet-outline" size={18} color={ACCENT} />
                  </View>
                  <Text style={styles.createAccountBtnText}>Recharger</Text>
                </Pressable>
              </View>

              {!user && !showRegisterOverlay && (
                <Pressable
                  style={({ pressed }) => [
                    styles.createAccountBtn,
                    pressed && styles.createAccountBtnPressed,
                  ]}
                  onPress={() => {
                    Keyboard.dismiss();
                    setRegisterInviteVisible(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Créer un compte"
                >
                  <View style={styles.createAccountBtnIcon}>
                    <Ionicons name="person-add-outline" size={18} color={ACCENT} />
                  </View>
                  <Text style={styles.createAccountBtnText}>Créer un compte</Text>
                </Pressable>
              )}

              {/* SECTION PROFIL */}
              <View style={styles.profileSection}>
                {!detectedDriver.avatar ? (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarLetter}>{detectedDriver.name.charAt(0)}</Text>
                  </View>
                ) : (
                  <Image source={detectedDriver.avatar} style={styles.avatar} />
                )}
                <Text style={styles.driverName}>{detectedDriver.name}</Text>
                <Text style={styles.driverPhone}>{detectedDriver.phone}</Text>
              </View>

              {/* SECTION INPUT */}
              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>Entrer montant à payer</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.amountInput}
                    placeholder="0"
                    placeholderTextColor="#DDD"
                    keyboardType="numeric"
                    returnKeyType="done"
                    onSubmitEditing={handlePay}
                    value={amount}
                    onChangeText={setAmount}
                    maxLength={7}
                    autoFocus={!showRegisterOverlay}
                    showSoftInputOnFocus={true}
                  />
                  <Text style={styles.currency}>FCFA</Text>
                </View>
              </View>

              {/* SECTION BOUTON - Poussée vers le bas par marginTop: 'auto' */}
              <View style={styles.actionSection}>
                <Pressable
                  style={({ pressed }) => [
                    styles.payButton,
                    (pressed || paymentStatus === 'SENDING') && styles.payButtonPressed,
                    (!amount || paymentStatus === 'SENDING') && styles.payButtonDisabled,
                  ]}
                  onPress={handlePay}
                  disabled={!amount || paymentStatus === 'SENDING'}
                >
                  {paymentStatus === 'SENDING' ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.payButtonText}>Payer maintenant</Text>
                  )}
                </Pressable>
              </View>

            </ScrollView>
          </SafeAreaView>

          <Modal
            visible={showRegisterOverlay}
            transparent
            animationType="slide"
            statusBarTranslucent
            onRequestClose={() => setRegisterInviteVisible(false)}
          >
            <View style={styles.regModalRoot}>
              <Pressable
                style={styles.regModalBackdrop}
                onPress={() => {
                  Keyboard.dismiss();
                  setRegisterInviteVisible(false);
                }}
                accessibilityLabel="Fermer"
                accessibilityRole="button"
              />
              <View style={[styles.regModalSheet, { marginTop: regSheetTop }]}>
                <KeyboardAvoidingView
                  style={styles.regModalKeyboard}
                  behavior={Platform.OS === "ios" ? "padding" : "height"}
                >
                  <SafeModalArea
                    style={styles.regModalSafe}
                    edges={["bottom", "left", "right"]}
                  >
                    <View style={styles.regModalHeader}>
                      <Pressable
                        onPress={() => {
                          Keyboard.dismiss();
                          setRegisterInviteVisible(false);
                        }}
                        style={({ pressed }) => [
                          styles.regModalCloseBtn,
                          pressed && styles.regModalCloseBtnPressed,
                        ]}
                        hitSlop={12}
                      >
                        <Ionicons name="close" size={28} color="#333" />
                      </Pressable>
                      <Text style={styles.regModalHeaderTitle}>
                        {welcomeStep === "phone" ? "Inscription" : "Code SMS"}
                      </Text>
                      <View style={styles.regModalHeaderSpacer} />
                    </View>

                    <ScrollView
                      contentContainerStyle={styles.regModalScroll}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      {welcomeStep === "phone" ? (
                        <>
                          <Text style={styles.regModalLead}>
                            Créez votre compte en quelques secondes. Nous vous enverrons un code
                            par SMS pour vérifier votre numéro.
                          </Text>
                          <Text style={styles.regModalLabel}>Numéro de téléphone</Text>
                          <View style={styles.regModalPhoneWrap}>
                            <Text style={styles.regModalPrefix}>+237</Text>
                            <TextInput
                              ref={regPhoneInputRef}
                              style={styles.regModalPhoneInput}
                              placeholder="612345678"
                              placeholderTextColor="#CCC"
                              keyboardType="number-pad"
                              maxLength={9}
                              value={welcomePhone}
                              onChangeText={(t) =>
                                setWelcomePhone(normalizeCameroonPhoneDigits(t))
                              }
                              showSoftInputOnFocus
                            />
                          </View>
                          <Pressable
                            style={({ pressed }) => [
                              styles.regModalPrimaryBtn,
                              pressed &&
                                welcomePhone.length === 9 &&
                                !authOtpSending &&
                                styles.regModalPrimaryBtnPressed,
                              (welcomePhone.length !== 9 || authOtpSending) &&
                                styles.regModalPrimaryBtnDisabled,
                            ]}
                            disabled={welcomePhone.length !== 9 || authOtpSending}
                            onPress={async () => {
                              if (welcomePhone.length !== 9) return;
                              Keyboard.dismiss();
                              setAuthOtpSending(true);
                              try {
                                await requestOtp(welcomePhone);
                                setWelcomeStep("otp");
                              } catch (e) {
                                Alert.alert(
                                  "Code SMS",
                                  e instanceof ApiError
                                    ? e.message
                                    : "Impossible d’envoyer le code.",
                                );
                              } finally {
                                setAuthOtpSending(false);
                              }
                            }}
                          >
                            {authOtpSending ? (
                              <ActivityIndicator color="#fff" size="small" />
                            ) : (
                              <Text style={styles.regModalPrimaryBtnText}>Continuer</Text>
                            )}
                          </Pressable>
                        </>
                      ) : (
                        <>
                          <Text style={styles.regModalLead}>
                            {USE_MOCK_API
                              ? `Démo : saisissez ${OTP_LEN} chiffres au choix, puis Valider.`
                              : `Saisissez le code à ${OTP_LEN} chiffres reçu par SMS.`}
                          </Text>
                          <Text style={styles.regModalOtpHint}>
                            +237{" "}
                            {welcomePhone
                              ? formatCameroonPhoneDisplay(welcomePhone)
                              : "…"}
                          </Text>
                          <Text style={styles.regModalLabel}>Code de vérification</Text>
                          <TextInput
                            ref={regOtpInputRef}
                            style={styles.regModalOtpInput}
                            placeholder="• • • • • •"
                            placeholderTextColor="#DDD"
                            keyboardType="number-pad"
                            value={welcomeOtp}
                            onChangeText={(t) =>
                              setWelcomeOtp(t.replace(/\D/g, "").slice(0, OTP_LEN))
                            }
                            maxLength={OTP_LEN}
                            textContentType="oneTimeCode"
                            autoComplete="sms-otp"
                            showSoftInputOnFocus
                          />
                          <Pressable
                            style={({ pressed }) => [
                              styles.regModalPrimaryBtn,
                              pressed &&
                                welcomeOtp.length === OTP_LEN &&
                                !authVerifySending &&
                                styles.regModalPrimaryBtnPressed,
                              (welcomeOtp.length !== OTP_LEN || authVerifySending) &&
                                styles.regModalPrimaryBtnDisabled,
                            ]}
                            disabled={
                              welcomeOtp.length !== OTP_LEN || authVerifySending
                            }
                            onPress={async () => {
                              if (welcomeOtp.length !== OTP_LEN) return;
                              Keyboard.dismiss();
                              setAuthVerifySending(true);
                              try {
                                await verifyAndSignIn(welcomePhone, welcomeOtp);
                                setRegisterInviteVisible(false);
                              } catch (e) {
                                Alert.alert(
                                  "Vérification",
                                  e instanceof ApiError
                                    ? e.message
                                    : "Code invalide.",
                                );
                              } finally {
                                setAuthVerifySending(false);
                              }
                            }}
                          >
                            {authVerifySending ? (
                              <ActivityIndicator color="#fff" size="small" />
                            ) : (
                              <Text style={styles.regModalPrimaryBtnText}>Valider</Text>
                            )}
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [
                              styles.regModalBackLink,
                              pressed && { opacity: 0.6 },
                            ]}
                            onPress={() => {
                              Keyboard.dismiss();
                              setWelcomeStep("phone");
                            }}
                          >
                            <Text style={styles.regModalBackLinkText}>
                              Modifier le numéro
                            </Text>
                          </Pressable>
                        </>
                      )}
                    </ScrollView>
                  </SafeModalArea>
                </KeyboardAvoidingView>
              </View>
            </View>
          </Modal>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingBottom: 52,
  },
  balanceWrap: {
    alignItems: "center",
    marginTop: 18,
    marginBottom: 4,
  },
  /** Même base que `createAccountBtn`, espacement sous le solde. */
  rechargeBtn: {
    marginTop: 8,
    marginBottom: 0,
  },
  createAccountBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginTop: 10,
    marginBottom: 5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: ACCENT,
    backgroundColor: "#fff",
  },
  createAccountBtnIcon: { marginRight: 8 },
  createAccountBtnPressed: {
    backgroundColor: "rgba(93, 199, 5, 0.08)",
    transform: [{ scale: 0.99 }],
  },
  createAccountBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: ACCENT,
  },
  balanceAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    maxWidth: "100%",
    flexWrap: "wrap",
  },
  balanceLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#888",
    marginRight: 8,
  },
  balanceAmountNum: {
    fontSize: 18,
    fontWeight: "800",
    color: "#222",
  },
  balanceCurrency: {
    fontSize: 13,
    fontWeight: "700",
    color: "#AAA",
    marginLeft: 6,
  },
  balanceReassuranceRow: {
    marginTop: 0,
    paddingHorizontal: 12,
    alignItems: "center",
    alignSelf: "center",
    maxWidth: 320,
  },
  balanceReassuranceInner: {
    flexDirection: "row",
    alignItems: "flex-start",
    maxWidth: 300,
  },
  balanceReassuranceIcon: {
    marginRight: 5,
    marginTop: 1,
  },
  balanceReassurance: {
    flex: 1,
    flexShrink: 1,
    fontSize: 9,
    fontWeight: "300",
    color: "#999",
    lineHeight: 14,
  },
  /** Modal inscription — aligné sur `app/deposit.tsx` (feuille + header). */
  regModalRoot: {
    flex: 1,
    backgroundColor: "transparent",
  },
  regModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  regModalSheet: {
    flex: 1,
    backgroundColor: "#fff",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
  },
  regModalKeyboard: {
    flex: 1,
  },
  regModalSafe: {
    flex: 1,
  },
  regModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F0F0F0",
  },
  regModalCloseBtn: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  regModalCloseBtnPressed: { opacity: 0.6 },
  regModalHeaderTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#333",
  },
  regModalHeaderSpacer: { width: 44 },
  regModalScroll: {
    paddingHorizontal: 25,
    paddingTop: 10,
    paddingBottom: 28,
  },
  regModalLead: {
    fontSize: 13,
    color: "#666",
    lineHeight: 19,
    marginBottom: 22,
  },
  regModalLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    marginBottom: 10,
    letterSpacing: 0.8,
    textAlign: "center",
  },
  regModalPhoneWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F8F8",
    borderRadius: 20,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 20,
    minHeight: 56,
  },
  regModalPrefix: {
    fontSize: 17,
    fontWeight: "700",
    color: "#333",
    marginRight: 10,
  },
  regModalPhoneInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#222",
    paddingVertical: 14,
  },
  regModalPrimaryBtn: {
    backgroundColor: ACCENT,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
  },
  regModalPrimaryBtnPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  regModalPrimaryBtnDisabled: {
    backgroundColor: "#CCC",
  },
  regModalPrimaryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  regModalOtpHint: {
    fontSize: 14,
    fontWeight: "600",
    color: "#555",
    textAlign: "center",
    marginBottom: 16,
  },
  regModalOtpInput: {
    width: "100%",
    height: 56,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    color: "#222",
    backgroundColor: "#F8F8F8",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  regModalBackLink: {
    alignSelf: "center",
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  regModalBackLinkText: {
    fontSize: 14,
    fontWeight: "600",
    color: ACCENT,
    textDecorationLine: "underline",
  },
  profileSection: {
    alignItems: "center",
    marginTop: 22,
    marginBottom: 32,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    marginBottom: 14,
  },
  avatarPlaceholder: {
    backgroundColor: "#f0f0f0",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#EEE",
  },
  avatarLetter: {
    fontSize: 40,
    fontWeight: "bold",
    color: ACCENT,
  },
  driverName: {
    fontSize: 18,
    fontWeight: "700",
    color: "#333",
  },
  driverPhone: {
    fontSize: 15,
    color: "#888",
    marginTop: 4,
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 13,
    color: "#888",
    fontWeight: "600",
    marginBottom: 10,
    letterSpacing: 0.8,
    textAlign: 'center'
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F8F8",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#EEE",
  },
  amountInput: {
    flex: 1,
    height: 72,
    fontSize: 28,
    fontWeight: "bold",
    color: "#222",
  },
  currency: {
    fontSize: 19,
    fontWeight: "800",
    color: "#AAA",
    marginLeft: 10,
  },
  actionSection: {
    marginTop: 'auto',    // Espace de sécurité
  },
  payButton: {
    backgroundColor: ACCENT,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  payButtonPressed: {
    backgroundColor: "#4bb004",
    transform: [{ scale: 0.98 }],
  },
  payButtonDisabled: {
    backgroundColor: "#CCCCCC",
    elevation: 0,
  },
  payButtonText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "bold",
    letterSpacing: 0.2,
  },
  successContainer: {
    flex: 1,
    backgroundColor: ACCENT,
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  successEmoji: { fontSize: 76 },
  successText: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "900",
    marginTop: 8,
  },
  successSub: {
    color: "#ffffff",
    fontSize: 14,
    opacity: 0.9,
    marginTop: 8,
    textAlign: "center",
  },
  resetButton: {
    marginTop: 44,
    paddingVertical: 12,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 16
  },
  resetButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "bold",
  },
});