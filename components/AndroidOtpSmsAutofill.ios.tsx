type Props = {
  applyOtp: boolean;
  otpLength: number;
  onCode: (digits: string) => void;
};

/** iOS : pas de SMS Retriever ; l’auto-saisie passe par le clavier (textContentType oneTimeCode). */
export function AndroidOtpSmsAutofill(_props: Props) {
  return null;
}
