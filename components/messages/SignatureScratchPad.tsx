import { useTheme } from "@/contexts/ThemeContext";
import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PanResponder,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";

type Point = { x: number; y: number };

type Props = {
  onSignedChange: (signed: boolean) => void;
};

export function SignatureScratchPad({ onSignedChange }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [dots, setDots] = useState<Point[]>([]);
  const sizeRef = useRef({ w: 1, h: 1 });

  const clear = () => {
    setDots([]);
    onSignedChange(false);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setDots((d) => {
            const next = [...d, { x: locationX, y: locationY }].slice(-400);
            if (next.length > 2) onSignedChange(true);
            return next;
          });
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setDots((d) => {
            const next = [...d, { x: locationX, y: locationY }].slice(-400);
            if (next.length > 2) onSignedChange(true);
            return next;
          });
        },
      }),
    [onSignedChange],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    sizeRef.current = {
      w: e.nativeEvent.layout.width,
      h: e.nativeEvent.layout.height,
    };
  };

  return (
    <View>
      <View
        style={{
          height: 112,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.borderLight,
          backgroundColor: colors.surfaceMuted,
          overflow: "hidden",
        }}
        onLayout={onLayout}
        {...pan.panHandlers}
      >
        {dots.map((p, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: p.x - 1.5,
              top: p.y - 1.5,
              width: 3,
              height: 3,
              borderRadius: 2,
              backgroundColor: colors.text,
            }}
          />
        ))}
        {dots.length === 0 ? (
          <Text
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              top: 44,
              textAlign: "center",
              fontSize: 13,
              color: colors.textFaint,
            }}
            pointerEvents="none"
          >
            {t("moneyReceipt.signatureHint")}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={clear}
        hitSlop={8}
        accessibilityRole="button"
        style={{ alignSelf: "flex-end", marginTop: 6, paddingVertical: 4 }}
      >
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.accent }}>
          {t("moneyReceipt.signatureClear")}
        </Text>
      </Pressable>
    </View>
  );
}
