import { MessageBubbleMetaRow } from "@/components/messages/MessageBubbleMeta";
import { SwipeToReplyWrap } from "@/components/messages/SwipeToReplyWrap";
import { peekVoiceCache } from "@/lib/voice/cache";
import { formatVoiceClock } from "@/lib/voice/formatVoiceClock";
import {
  ensureVoiceWaveformPeaks,
  flatVoiceWaveformHeights,
  getCachedVoiceWaveformHeights,
  subscribeVoiceWaveform,
  voiceWaveformCacheKey,
} from "@/lib/voice/waveformPeaks";
import type { ChatMessage } from "@/lib/api/types";
import {
  beginVoiceScrub,
  commitVoiceScrub,
  cycleVoiceRate,
  getVoiceRate,
  getVoiceStatus,
  subscribeVoiceStatus,
  type VoicePlayStatus,
} from "@/lib/voice/play";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  InteractionManager,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector, Pressable } from "react-native-gesture-handler";
import { runOnJS, useSharedValue } from "react-native-reanimated";

/** Glisser horizontal sur la piste : un peu plus réactif qu’1:1 strict. */
const SCRUB_DRAG_GAIN = 1.1;

type Styles = {
  voiceRow: StyleProp<ViewStyle>;
  voiceSpeedPill: StyleProp<ViewStyle>;
  voiceSpeedText: StyleProp<TextStyle>;
  voicePlayBtn: StyleProp<ViewStyle>;
  voiceMetaRow: StyleProp<ViewStyle>;
  voiceBubbleStack: StyleProp<ViewStyle>;
  voiceWaveArea: StyleProp<ViewStyle>;
  voiceWaveBars: StyleProp<ViewStyle>;
  voiceWaveBar: StyleProp<ViewStyle>;
  voiceScrubber: StyleProp<ViewStyle>;
  voiceDurMeta: StyleProp<TextStyle>;
};

type MetaProps = React.ComponentProps<typeof MessageBubbleMetaRow>;

type Props = {
  message: ChatMessage;
  durationMs: number;
  ink: string;
  /** Contour de la boule scrub (couleur fond bulle) pour contraste sur la piste. */
  scrubRingColor: string;
  styles: Styles;
  onToggle: (msg: ChatMessage) => void;
  metaTextProps: MetaProps;
  swipeReplyEnabled?: boolean;
  onSwipeReply?: () => void;
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
  scrubRingColor,
  styles,
  onToggle,
  metaTextProps,
  swipeReplyEnabled = false,
  onSwipeReply,
}: Props) {
  const { t } = useTranslation();
  const [st, setSt] = useState<VoicePlayStatus>(getVoiceStatus);
  const [globalRate, setGlobalRate] = useState(getVoiceRate);
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [resolvedDurMs, setResolvedDurMs] = useState(durationMs);
  const trackW = useRef(0);
  const [trackLayoutW, setTrackLayoutW] = useState(0);
  const swipeRootRef = useRef<View>(null);
  const waveTrackRef = useRef<View>(null);
  const trackExX = useSharedValue(0);
  const trackExY = useSharedValue(0);
  const trackExW = useSharedValue(0);
  const trackExH = useSharedValue(0);
  const knownDur = useRef(durationMs);
  const scrubMsRef = useRef(0);
  const dragging = useRef(false);
  const wasActive = useRef(false);
  const activeRef = useRef(false);

  const waveCacheKey = voiceWaveformCacheKey(
    message.voice?.key,
    message.id,
  );
  const [barHeights, setBarHeights] = useState(() =>
    getCachedVoiceWaveformHeights(waveCacheKey) ?? flatVoiceWaveformHeights(),
  );

  useEffect(() => {
    let cancelled = false;
    const apply = (heights: number[]) => {
      if (!cancelled) setBarHeights(heights);
    };
    const cached = getCachedVoiceWaveformHeights(waveCacheKey);
    if (cached) {
      apply(cached);
      return;
    }
    apply(flatVoiceWaveformHeights());
    const unsub = subscribeVoiceWaveform(waveCacheKey, () => {
      const next = getCachedVoiceWaveformHeights(waveCacheKey);
      if (next) apply(next);
    });
    void (async () => {
      let uri = message.voice?.localUri?.trim() || "";
      if (!uri && message.voice?.key) {
        uri = (await peekVoiceCache(message.voice.key)) || "";
      }
      if (!uri || cancelled) return;
      InteractionManager.runAfterInteractions(() => {
        void ensureVoiceWaveformPeaks(waveCacheKey, uri).then((h) => {
          if (!cancelled) apply(h);
        });
      });
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [waveCacheKey, message.voice?.key, message.voice?.localUri]);

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
      setSt(
        first.messageId
          ? { ...first, messageId: null, playing: false, paused: false, positionMs: 0 }
          : first,
      );
    }
    return subscribeVoiceStatus((next) => {
      setGlobalRate(next.rate);
      const mine = next.messageId === message.id;
      if (!mine && !wasActive.current) return;
      wasActive.current = mine;
      activeRef.current = mine;
      if (mine && next.durationMs > 0) {
        knownDur.current = next.durationMs;
        setResolvedDurMs(next.durationMs);
      }
      if (dragging.current) return;
      setSt(mine ? next : getVoiceStatus());
    });
  }, [message.id]);

  const scrubAnchorMs = useRef(0);

  const msFromLocalX = useCallback((localX: number) => {
    const w = trackW.current;
    const dur = knownDur.current;
    if (w <= 0 || dur <= 0) return 0;
    const x = Math.max(0, Math.min(w, localX));
    return (x / w) * dur;
  }, []);

  const clampMs = useCallback((ms: number) => {
    const dur = knownDur.current;
    if (dur <= 0) return 0;
    return Math.max(0, Math.min(dur, ms));
  }, []);

  const applyScrubUi = useCallback((ms: number) => {
    const next = clampMs(ms);
    scrubMsRef.current = Math.round(next);
    setScrubMs(next);
  }, [clampMs]);

  const scrubBeginAt = useCallback(
    (localX: number) => {
      if (!activeRef.current) return;
      dragging.current = true;
      void beginVoiceScrub();
      const ms = msFromLocalX(localX);
      scrubAnchorMs.current = ms;
      applyScrubUi(ms);
    },
    [applyScrubUi, msFromLocalX],
  );

  const scrubDragBy = useCallback(
    (translationX: number) => {
      if (!dragging.current) return;
      const w = trackW.current;
      const dur = knownDur.current;
      if (w <= 0 || dur <= 0) return;
      const ms =
        scrubAnchorMs.current + (translationX / w) * dur * SCRUB_DRAG_GAIN;
      applyScrubUi(ms);
    },
    [applyScrubUi],
  );

  const finishScrub = useCallback(async () => {
    if (!dragging.current) return;
    dragging.current = false;
    const ms = scrubMsRef.current;
    await commitVoiceScrub(ms);
    setScrubMs(null);
    setSt(getVoiceStatus());
  }, []);

  const active = st.messageId === message.id;

  const syncTrackExclusion = useCallback(() => {
    const root = swipeRootRef.current;
    const wave = waveTrackRef.current;
    if (!root || !wave) return;
    wave.measureLayout(
      root,
      (x, y, width, height) => {
        trackExX.value = x;
        trackExY.value = y;
        trackExW.value = width;
        trackExH.value = height;
      },
      () => {},
    );
  }, [trackExH, trackExW, trackExX, trackExY]);

  const trackExclusion = useMemo(
    () => ({
      x: trackExX,
      y: trackExY,
      w: trackExW,
      h: trackExH,
    }),
    [trackExH, trackExW, trackExX, trackExY],
  );

  const playing = active && st.playing;
  const rate = active ? st.rate : globalRate;
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
  const durStyle = [styles.voiceDurMeta, { color: ink, opacity: 0.62 }];
  const playedIndex = pct * barHeights.length;
  const trackPx = trackLayoutW > 0 ? trackLayoutW : trackW.current;
  const scrubberLeft =
    trackPx > 0 ? Math.max(0, Math.min(trackPx, pct * trackPx)) - 8.5 : 0;

  const scrubGesture = React.useMemo(() => {
    return Gesture.Pan()
      .enabled(active)
      .maxPointers(1)
      .blocksExternalGesture(active)
      .failOffsetY([-26, 26])
      .onBegin((e) => {
        "worklet";
        runOnJS(scrubBeginAt)(e.x);
      })
      .onUpdate((e) => {
        "worklet";
        runOnJS(scrubDragBy)(e.translationX);
      })
      .onEnd(() => {
        "worklet";
        runOnJS(finishScrub)();
      })
      .onFinalize((_e, success) => {
        "worklet";
        if (!success) {
          runOnJS(finishScrub)();
        }
      });
  }, [active, finishScrub, scrubBeginAt, scrubDragBy]);

  const onReply = onSwipeReply ?? (() => {});

  return (
    <SwipeToReplyWrap
      enabled={swipeReplyEnabled}
      onReply={onReply}
      trackExclusion={trackExclusion}
    >
      <View
        ref={swipeRootRef}
        style={styles.voiceBubbleStack}
        onLayout={syncTrackExclusion}
      >
        <View style={styles.voiceRow}>
          <Pressable
            style={styles.voiceSpeedPill}
            onPress={() => cycleVoiceRate()}
            accessibilityRole="button"
            accessibilityLabel={t("messages.voiceSpeedA11y", {
              rate: rateLabel(rate, t),
            })}
            hitSlop={4}
          >
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFillObject,
                styles.voiceSpeedPillBg,
                { backgroundColor: ink },
              ]}
            />
            <Text style={[styles.voiceSpeedText, { color: ink }]}>
              {rateLabel(rate, t)}
            </Text>
          </Pressable>

          <Pressable
            style={styles.voicePlayBtn}
            onPress={() => onToggle(message)}
            accessibilityRole="button"
            accessibilityLabel={
              playing ? t("messages.voicePause") : t("messages.voicePlay")
            }
            hitSlop={8}
          >
            <Ionicons
              name={playing ? "pause" : "play"}
              size={22}
              color={ink}
              style={playing ? undefined : { marginLeft: 3 }}
            />
          </Pressable>

          <GestureDetector gesture={scrubGesture}>
            <View
              ref={waveTrackRef}
              style={styles.voiceWaveArea}
              pointerEvents={active ? "auto" : "none"}
              onLayout={(e) => {
                const w = e.nativeEvent.layout.width;
                trackW.current = w;
                if (w !== trackLayoutW) setTrackLayoutW(w);
                syncTrackExclusion();
              }}
            >
              <View style={styles.voiceWaveBars} pointerEvents="none">
                {barHeights.map((h, i) => {
                  const played = i + 0.5 <= playedIndex;
                  return (
                    <View
                      key={i}
                      style={[
                        styles.voiceWaveBar,
                        {
                          height: h,
                          backgroundColor: ink,
                          opacity: played ? 0.95 : 0.32,
                        },
                      ]}
                    />
                  );
                })}
              </View>
              {active ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.voiceScrubber,
                    {
                      left: scrubberLeft,
                      backgroundColor: ink,
                      borderColor: scrubRingColor,
                    },
                  ]}
                />
              ) : null}
            </View>
          </GestureDetector>
        </View>
        <View style={styles.voiceMetaRow}>
          <MessageBubbleMetaRow
            {...metaTextProps}
            trailingText={durLabel}
            trailingTextStyle={durStyle}
            trailingTextAtStart
          />
        </View>
      </View>
    </SwipeToReplyWrap>
  );
});