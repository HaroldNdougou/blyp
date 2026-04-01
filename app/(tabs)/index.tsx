import { useAuth } from "@/contexts/AuthContext";
import { ApiError, pay as apiPay } from "@/lib/api/client";
import { USE_MOCK_API } from "@/lib/config";
import { formatFcfa } from "@/lib/format";
import { Ionicons } from "@expo/vector-icons";
import { router, Stack } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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

/** Vert identité Blyp */
const BLYP_GREEN = "#5dc705";
const ACCENT = BLYP_GREEN;

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
  const [overlaySlideW, setOverlaySlideW] = useState(0);
  const slideProgress = useRef(new Animated.Value(0)).current;
  const [authOtpSending, setAuthOtpSending] = useState(false);
  const [authVerifySending, setAuthVerifySending] = useState(false);
  const inviteBootstrapped = useRef(false);

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
      slideProgress.setValue(0);
    } else {
      setWelcomeStep("phone");
      setWelcomeOtp("");
      setWelcomePhone("");
      slideProgress.setValue(0);
    }
  }, [registerInviteVisible, slideProgress]);

  useEffect(() => {
    if (overlaySlideW <= 0) return;
    Animated.spring(slideProgress, {
      toValue: welcomeStep === "otp" ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 68,
    }).start();
  }, [welcomeStep, overlaySlideW, slideProgress]);

  const overlaySlideTx = slideProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -overlaySlideW],
  });

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
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => setRegisterInviteVisible(false)}
          >
            <KeyboardAvoidingView
              style={styles.overlayKeyboardRoot}
              behavior={Platform.OS === "ios" ? "padding" : "height"}
            >
              <View style={styles.overlayRoot}>
                <Pressable
                  style={styles.overlayBackdrop}
                  onPress={() => {
                    Keyboard.dismiss();
                    setRegisterInviteVisible(false);
                  }}
                  accessibilityLabel="Fermer"
                  accessibilityHint="Ferme la fenêtre d'inscription"
                />
                <View style={styles.overlayCenter} pointerEvents="box-none">
                  <View style={styles.overlayCard} accessibilityRole="none">
                    <Text style={styles.overlayEyebrow}>Bienvenue</Text>
                    <Text style={styles.overlayTitle}>
                      Créez votre compte en quelques secondes pour sécuriser vos paiements.
                    </Text>

                    <View
                      style={styles.overlaySlideViewport}
                      onLayout={(e) => setOverlaySlideW(e.nativeEvent.layout.width)}
                    >
                      <Animated.View
                        style={[
                          styles.overlaySlideRow,
                          {
                            width: overlaySlideW > 0 ? overlaySlideW * 2 : undefined,
                            transform: [{ translateX: overlaySlideTx }],
                          },
                        ]}
                      >
                        <View
                          style={[styles.overlaySlidePage, overlaySlideW > 0 && { width: overlaySlideW }]}
                        >
                          <Text style={styles.overlaySub}>
                            {USE_MOCK_API
                              ? "Sans serveur : après Continuer, vous pourrez entrer n’importe quel code à 6 chiffres (démo locale)."
                              : "Nous vous enverrons un code par SMS — sans mot de passe à retenir."}
                          </Text>
                          <Text style={styles.overlayFieldLabel}>Numéro de téléphone</Text>
                          <View style={styles.overlayPhoneWrap}>
                            <Text style={styles.overlayPrefix}>+237</Text>
                            <TextInput
                              style={styles.overlayPhoneInput}
                              placeholder="6 XX XX XX XX"
                              placeholderTextColor="#CCC"
                              keyboardType="phone-pad"
                              value={welcomePhone}
                              onChangeText={setWelcomePhone}
                              maxLength={12}
                            />
                          </View>
                          <Pressable
                            style={({ pressed }) => [
                              styles.overlayPrimaryBtn,
                              pressed &&
                                welcomePhone.trim() &&
                                !authOtpSending &&
                                styles.overlayPrimaryBtnPressed,
                              (!welcomePhone.trim() || authOtpSending) &&
                                styles.overlayPrimaryBtnDisabled,
                            ]}
                            disabled={
                              !welcomePhone.trim() || authOtpSending
                            }
                            onPress={async () => {
                              if (!welcomePhone.trim()) return;
                              Keyboard.dismiss();
                              setAuthOtpSending(true);
                              try {
                                await requestOtp(welcomePhone.trim());
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
                              <Text style={styles.overlayPrimaryBtnText}>
                                Continuer
                              </Text>
                            )}
                          </Pressable>
                        </View>

                        <View
                          style={[styles.overlaySlidePage, overlaySlideW > 0 && { width: overlaySlideW }]}
                        >
                          <Text style={styles.overlaySub}>
                            {USE_MOCK_API
                              ? `Démo : saisissez ${OTP_LEN} chiffres au choix, puis Valider.`
                              : `Saisissez le code à ${OTP_LEN} chiffres reçu par SMS.`}
                          </Text>
                          <Text style={styles.overlayOtpHint}>
                            +237 {welcomePhone.trim() || "…"}
                          </Text>
                          <Text style={styles.overlayFieldLabel}>Code de vérification</Text>
                          <TextInput
                            style={styles.overlayOtpInput}
                            placeholder="• • • • • •"
                            placeholderTextColor="#DDD"
                            keyboardType="number-pad"
                            value={welcomeOtp}
                            onChangeText={(t) => setWelcomeOtp(t.replace(/\D/g, "").slice(0, OTP_LEN))}
                            maxLength={OTP_LEN}
                            textContentType="oneTimeCode"
                            autoComplete="sms-otp"
                          />
                          <Pressable
                            style={({ pressed }) => [
                              styles.overlayPrimaryBtn,
                              pressed &&
                                welcomeOtp.length === OTP_LEN &&
                                !authVerifySending &&
                                styles.overlayPrimaryBtnPressed,
                              (welcomeOtp.length !== OTP_LEN || authVerifySending) &&
                                styles.overlayPrimaryBtnDisabled,
                            ]}
                            disabled={
                              welcomeOtp.length !== OTP_LEN || authVerifySending
                            }
                            onPress={async () => {
                              if (welcomeOtp.length !== OTP_LEN) return;
                              Keyboard.dismiss();
                              setAuthVerifySending(true);
                              try {
                                await verifyAndSignIn(
                                  welcomePhone.trim(),
                                  welcomeOtp,
                                );
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
                              <Text style={styles.overlayPrimaryBtnText}>
                                Valider
                              </Text>
                            )}
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [
                              styles.overlayBackLink,
                              pressed && { opacity: 0.6 },
                            ]}
                            onPress={() => {
                              Keyboard.dismiss();
                              setWelcomeStep("phone");
                            }}
                          >
                            <Text style={styles.overlayBackLinkText}>Modifier le numéro</Text>
                          </Pressable>
                        </View>
                      </Animated.View>
                    </View>
                  </View>
                </View>
              </View>
            </KeyboardAvoidingView>
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
  overlayKeyboardRoot: {
    flex: 1,
  },
  overlayRoot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.9)",
  },
  overlayCenter: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 22,
  },
  overlayCard: {
    width: "100%",
    maxWidth: 312,
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: "#EEE",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 6,
  },
  overlayEyebrow: {
    fontSize: 10,
    fontWeight: "700",
    color: ACCENT,
    letterSpacing: 1,
    textAlign: "center",
    marginBottom: 6,
  },
  overlayTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 8,
  },
  overlaySub: {
    fontSize: 13,
    color: "#777",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 16,
  },
  overlayFieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888",
    marginBottom: 8,
    letterSpacing: 0.8,
  },
  overlayPhoneWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F8F8",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EEE",
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  overlayPrefix: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginRight: 8,
  },
  overlayPhoneInput: {
    flex: 1,
    height: 48,
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
  },
  overlayPrimaryBtn: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: ACCENT,
    height: 46,
    borderRadius: 23,
    paddingHorizontal: 16,
  },
  overlayPrimaryBtnPressed: {
    backgroundColor: "#4bb004",
    transform: [{ scale: 0.98 }],
  },
  overlayPrimaryBtnDisabled: {
    backgroundColor: "#CCC",
  },
  overlayPrimaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  overlaySlideViewport: {
    width: "100%",
    overflow: "hidden",
  },
  overlaySlideRow: {
    flexDirection: "row",
  },
  overlaySlidePage: {
    flexShrink: 0,
  },
  overlayOtpHint: {
    fontSize: 13,
    fontWeight: "600",
    color: "#555",
    textAlign: "center",
    marginBottom: 12,
  },
  overlayOtpInput: {
    width: "100%",
    height: 48,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 8,
    textAlign: "center",
    color: "#222",
    backgroundColor: "#F8F8F8",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EEE",
    marginBottom: 18,
    paddingHorizontal: 12,
  },
  overlayBackLink: {
    alignSelf: "center",
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  overlayBackLinkText: {
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