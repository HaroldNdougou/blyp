import { getAppHashAsync, useOtpAutoFill } from "expo-otp-autofill";
import { useEffect, useRef } from "react";
import { AppState, Clipboard, type AppStateStatus } from "react-native";

type Props = {
  applyOtp: boolean;
  otpLength: number;
  onCode: (digits: string) => void;
};

function sixDigitsFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\d{6}/);
  return m ? m[0] : null;
}

function normalizeOtpDigits(otp: string | null, len: number): string | null {
  if (!otp) return null;
  const d = otp.replace(/\D/g, "").slice(0, len);
  return d.length === len ? d : null;
}

/**
 * Android : SMS Retriever (hash 11 car. en fin de SMS côté serveur) + repli presse-papiers.
 * Monté dès l’ouverture du modal d’inscription pour ne pas rater un SMS rapide.
 */
export function AndroidOtpSmsAutofill({ applyOtp, otpLength, onCode }: Props) {
  const { otp: retrieverOtp } = useOtpAutoFill({ length: otpLength, timeout: 0 });
  const onCodeRef = useRef(onCode);
  const lastAppliedRef = useRef<string | null>(null);
  const loggedHashRef = useRef(false);
  onCodeRef.current = onCode;

  useEffect(() => {
    if (!__DEV__ || loggedHashRef.current) return;
    void getAppHashAsync().then((h) => {
      if (!h) return;
      loggedHashRef.current = true;
      console.log(
        "[Blyp] ANDROID_SMS_OTP_APP_HASH=" +
          h +
          " → copie dans .env serveur (puis redémarre l’API). Plusieurs builds : HASH1,HASH2",
      );
    });
  }, []);

  useEffect(() => {
    if (!applyOtp) return;
    const d = normalizeOtpDigits(retrieverOtp, otpLength);
    if (!d || lastAppliedRef.current === d) return;
    lastAppliedRef.current = d;
    onCodeRef.current(d);
  }, [applyOtp, retrieverOtp, otpLength]);

  useEffect(() => {
    if (!applyOtp) return;

    const tryClipboard = async () => {
      try {
        const raw = await Clipboard.getString();
        const d = sixDigitsFromText(raw);
        if (!d || d.length !== otpLength) return;
        if (lastAppliedRef.current === d) return;
        lastAppliedRef.current = d;
        onCodeRef.current(d);
      } catch {
        /* indisponible */
      }
    };

    const appState = { current: AppState.currentState as AppStateStatus };
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if ((prev === "background" || prev === "inactive") && next === "active") {
        void tryClipboard();
      }
    });
    return () => sub.remove();
  }, [applyOtp, otpLength]);

  return null;
}
