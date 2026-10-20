import { formatVoiceClock } from "@/lib/voice/record";
import type { ThemeColors } from "@/lib/theme/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { createVoiceRecordComposerStyles } from "@/components/messages/voiceRecordComposerStyles";

const WAVE_DOT_COUNT = 28;

function VoiceWaveDots({
  mode,
  durationMs,
  previewProgress,
  ink,
  styles,
}: {
  mode: "recording" | "paused";
  durationMs: number;
  previewProgress?: number;
  ink: string;
  styles: ReturnType<typeof createVoiceRecordComposerStyles>;
}) {
  const heights = useMemo(() => {
    const prog = previewProgress ?? 0;
    return Array.from({ length: WAVE_DOT_COUNT }, (_, i) => {
      if (mode === "paused" && previewProgress != null) {
        const played = (i + 0.5) / WAVE_DOT_COUNT <= prog;
        return played ? 14 : 5;
      }
      const phase = (durationMs / 180 + i) * 0.65;
      return 4 + Math.abs(Math.sin(phase)) * 12;
    });
  }, [mode, durationMs, previewProgress]);

  return (
    <View style={styles.waveRow}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={[
            styles.waveDot,
            { height: h, backgroundColor: ink, opacity: mode === "recording" ? 0.85 : 0.7 },
          ]}
        />
      ))}
    </View>
  );
}

type Props = {
  mode: "recording" | "paused";
  durationMs: number;
  previewPlaying: boolean;
  previewPositionMs: number;
  previewReady: boolean;
  sendBusy: boolean;
  colors: ThemeColors;
  onPause: () => void;
  onResume: () => void;
  onTogglePreview: () => void;
  onDelete: () => void;
  onSend: () => void;
};

export function VoiceRecordComposer({
  mode,
  durationMs,
  previewPlaying,
  previewPositionMs,
  previewReady,
  sendBusy,
  colors,
  onPause,
  onResume,
  onTogglePreview,
  onDelete,
  onSend,
}: Props) {
  const { t } = useTranslation();
  const styles = useMemo(
    () => createVoiceRecordComposerStyles(colors),
    [colors],
  );
  const clock = formatVoiceClock(durationMs);
  const previewProgress =
    mode === "paused" && durationMs > 0
      ? Math.min(1, previewPositionMs / durationMs)
      : undefined;

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        {mode === "paused" ? (
          <Pressable
            style={styles.playBtn}
            onPress={onTogglePreview}
            disabled={!previewReady}
            accessibilityLabel={
              previewPlaying
                ? t("messages.voicePreviewPause")
                : t("messages.voicePreviewListen")
            }
            hitSlop={6}
          >
            <Ionicons
              name={previewPlaying ? "pause" : "play"}
              size={22}
              color={previewReady ? colors.text : colors.textFaint}
            />
          </Pressable>
        ) : (
          <Text style={styles.topTime}>{clock}</Text>
        )}
        <VoiceWaveDots
          mode={mode}
          durationMs={durationMs}
          previewProgress={previewProgress}
          ink={mode === "recording" ? colors.destructive : colors.accent}
          styles={styles}
        />
        {mode === "paused" ? (
          <Text style={styles.topTime}>{clock}</Text>
        ) : (
          <View style={styles.topSpacer} />
        )}
      </View>
      <View style={styles.bottomRow}>
        <Pressable
          style={styles.deleteBtn}
          onPress={onDelete}
          accessibilityLabel={t("messages.voiceDelete")}
          hitSlop={6}
        >
          <Ionicons name="trash" size={20} color={colors.textInverse} />
        </Pressable>
        <Pressable
          style={[
            styles.primaryBtn,
            mode === "recording" ? styles.primaryBtnPause : styles.primaryBtnResume,
          ]}
          onPress={mode === "recording" ? onPause : onResume}
          accessibilityLabel={
            mode === "recording"
              ? t("messages.voicePauseRecording")
              : t("messages.voiceResumeRecord")
          }
        >
          <Ionicons
            name={mode === "recording" ? "pause" : "mic"}
            size={20}
            color={mode === "recording" ? colors.text : colors.accentOn}
          />
          <Text
            style={
              mode === "recording"
                ? styles.primaryBtnText
                : styles.primaryBtnTextOnAccent
            }
          >
            {mode === "recording"
              ? t("messages.voicePause")
              : t("messages.voiceResume")}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.sendBtn, sendBusy && styles.sendBtnDisabled]}
          onPress={onSend}
          disabled={sendBusy}
          accessibilityLabel={t("messages.voiceSend")}
          hitSlop={4}
        >
          <Ionicons name="send" size={18} color={colors.accentOn} />
        </Pressable>
      </View>
    </View>
  );
}
