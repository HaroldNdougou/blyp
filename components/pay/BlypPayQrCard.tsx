import { useTheme } from "@/contexts/ThemeContext";
import { buildBlypPayQrUrl } from "@/lib/pay/blypPayQr";
import { useMemo } from "react";
import { Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

export function BlypPayQrCard(props: {
  accountId: string;
  name: string;
  amountFcfa?: number | null;
  hint?: string;
  title?: string;
}) {
  const { colors } = useTheme();
  const value = useMemo(
    () =>
      buildBlypPayQrUrl({
        accountId: props.accountId,
        name: props.name,
        amountFcfa: props.amountFcfa,
      }),
    [props.accountId, props.name, props.amountFcfa],
  );
  if (!value) return null;

  return (
    <View style={{ alignItems: "center", gap: 16 }}>
      {props.title ? (
        <Text
          style={{
            fontSize: 18,
            fontWeight: "700",
            color: colors.text,
            textAlign: "center",
          }}
        >
          {props.title}
        </Text>
      ) : null}
      <View
        style={{
          padding: 16,
          borderRadius: 16,
          backgroundColor: colors.modal,
          borderWidth: 1,
          borderColor: colors.borderLight,
        }}
      >
        <QRCode value={value} size={220} backgroundColor={colors.modal} color={colors.text} />
      </View>
      {props.hint ? (
        <Text
          style={{
            fontSize: 14,
            color: colors.textMuted,
            textAlign: "center",
            paddingHorizontal: 12,
          }}
        >
          {props.hint}
        </Text>
      ) : null}
    </View>
  );
}
