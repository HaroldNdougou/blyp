import { MessageBubbleMetaRow } from "@/components/messages/MessageBubbleMeta";
import { formatVoiceClock } from "@/lib/voice/formatVoiceClock";
import type { ChatMessage } from "@/lib/api/types";
import {
  cycleVoiceRate,
  getVoiceStatus,
  seekVoice,
  subscribeVoiceStatus,
  type VoicePlayStatus,
} from "@/lib/voice/play";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

type Styles = {
  voiceRow: StyleProp<ViewStyle>;
  voicePlayCol: StyleProp<ViewStyle>;
  voicePlayBtn: StyleProp<ViewStyle>;
  voiceDurMeta: StyleProp<TextStyle>;
  voiceBubbleStack: StyleProp<ViewStyle>;
  voiceSeek: StyleProp<ViewStyle>;
  voiceTrackWrap: StyleProp<ViewStyle>;
  voiceTrack: StyleProp<ViewStyle>;
  voiceFill: StyleProp<ViewStyle>;
  voiceThumb: StyleProp<ViewStyle>;
  voiceMeta: StyleProp<ViewStyle>;
  voiceSpeed: StyleProp<ViewStyle>;
  voiceSpeedText: StyleProp<TextStyle>;
};

type MetaProps = React.ComponentProps<typeof MessageBubbleMetaRow>;

type Props = {
  message: ChatMessage;
  durationMs: number;
  ink: string;
  styles: Styles;
  onToggle: (msg: ChatMessage) => void;
  metaTextProps: MetaProps;
};

function rateLabel(rate: number, t: (key: string) => string): string {
  if (rate === 1.5) return t("messages.voiceRate15");
  if (rate === 2) return t("messages.voiceRate2");
  return t("messages.voiceRate1");
}

export const VoiceBubble = React.memo(function VoiceBubble({
  message,
  durationMs,
  ink,
  styles,
  onToggle,
  metaTextProps,
}: Props) {
  const { t } = useTranslation();
  const [st, setSt] = useState<VoicePlayStatus>(getVoiceStatus);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [resolvedDurMs, setResolvedDurMs] = useState(durationMs);
  const trackW = useRef(0);
  const knownDur = useRef(durationMs);
  const dragging = useRef(false);
  const wasActive = useRef(false);
  const activeRef = useRef(false);
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;

  useEffect(() => {
    knownDur.current = durationMs;
    if (durationMs > 0) setResolvedDurMs(durationMs);
  }, [durationMs]);

  useEffect(() => {
    wasActive.current = false;
    activeRef.current = false;
    dragging.current = false;
    setScrubMs(null);
    const first = getVoiceStatus();
    if (first.messageId === message.id) {
      wasActive.current = true;
      activeRef.current = true;
      setSt(first);
    } else {
      setSt(first.messageId ? { ...first, messageId: null, playing: false, paused: false, positionMs: 0 } : first);
    }
    return subscribeVoiceStatus((next) => {
      const mine = next.messageId === message.id;
      if (!mine && !wasActive.current) return;
      wasActive.current = mine;
      activeRef.current = mine;
      if (mine && next.durationMs > 0) {
        knownDur.current = next.durationMs;
        setResolvedDurMs(next.durationMs);
      }
      setSt(mine ? next : getVoiceStatus());
    });
  }, [message.id]);

  const seekFromX = useCallback((x: number) => {
    const w = trackW.current;
    const dur = knownDur.current;
    if (w <= 0 || dur <= 0) return;
    const ms = Math.max(0, Math.min(dur, (x / w) * dur));
    setScrubMs(ms);
    void seekVoice(ms);
  }, []);

  const onSeekGrant = (e: GestureResponderEvent) => {
    if (!activeRef.current) {
      toggleRef.current(message);
      return;
    }
    dragging.current = true;
    seekFromX(e.nativeEvent.locationX);
  };

  const onSeekMove = (e: GestureResponderEvent) => {
    if (!dragging.current) return;
    seekFromX(e.nativeEvent.locationX);
  };

  const onSeekEnd = () => {
    dragging.current = false;
    setScrubMs(null);
  };

  const active = st.messageId === message.id;
  const playing = active && st.playing;
  const total =
    resolvedDurMs > 0
      ? resolvedDurMs
      : active && st.durationMs > 0
        ? st.durationMs
        : durationMs;
  const pos = scrubMs != null ? scrubMs : active ? st.positionMs : 0;
  const shownMs =
    playing || (active && st.paused) ? Math.max(0, total - pos) : total;
  const pct = total > 0 ? Math.max(0, Math.min(1, pos / total)) : 0;
  const durLabel = total > 0 ? formatVoiceClock(shownMs) : "0:00";
  const durStyle = [styles.voiceDurMeta, { color: ink, opacity: 0.58 }];

  return (
    <View style={styles.voiceBubbleStack}>
      <View style={styles.voiceRow}>
      <View style={styles.voicePlayCol}>
        <Pressable
          style={styles.voicePlayBtn}
          onPress={() => onToggle(message)}
          accessibilityRole="button"
          accessibilityLabel={
            playing ? t("messages.voicePause") : t("messages.voicePlay")
          }
          hitSlop={6}
        >
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: ink, opacity: 0.16, borderRadius: 18 },
            ]}
          />
          <Ionicons
            name={playing ? "pause" : "play"}
            size={16}
            color={ink}
            style={playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>
      </View>
      <View
        style={styles.voiceSeek}
        onLayout={(e) => {
          trackW.current = e.nativeEvent.layout.width;
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => dragging.current}
        onResponderGrant={onSeekGrant}
        onResponderMove={onSeekMove}
        onResponderRelease={onSeekEnd}
        onResponderTerminate={onSeekEnd}
      >
        <View style={styles.voiceTrackWrap}>
          <View
            style={[styles.voiceTrack, { backgroundColor: ink, opacity: 0.22 }]}
          />
          <View
            style={[
              styles.voiceFill,
              { width: `${pct * 100}%`, backgroundColor: ink },
            ]}
          />
          {active ? (
            <View
              style={[
                styles.voiceThumb,
                { left: `${pct * 100}%`, backgroundColor: ink },
              ]}
            />
          ) : null}
        </View>
      </View>
      {active ? (
        <View style={styles.voiceMeta}>
          <Pressable
            onPress={() => cycleVoiceRate()}
            accessibilityRole="button"
            accessibilityLabel={t("messages.voiceSpeedA11y", {
              rate: rateLabel(st.rate, t),
            })}
            hitSlop={8}
            style={[styles.voiceSpeed, { borderColor: ink }]}
          >
            <Text style={[styles.voiceSpeedText, { color: ink }]}>
              {rateLabel(st.rate, t)}
            </Text>
          </Pressable>
        </View>
      ) : null}
      </View>
      <MessageBubbleMetaRow
        {...metaTextProps}
        trailingText={durLabel}
        trailingTextStyle={durStyle}
      />
    </View>
  );
});
