import React, { lazy, Suspense, type ComponentProps } from "react";
import { ActivityIndicator, View } from "react-native";
import type { ChatThreadMoneyModalProps } from "@/components/messages/ChatThreadMoneyModal";

const LazyChatAttachSheet = lazy(() =>
  import("@/components/messages/ChatAttachSheet").then((m) => ({
    default: m.ChatAttachSheet,
  })),
);

const LazyImageCaptionComposer = lazy(() =>
  import("@/components/messages/ImageCaptionComposer").then((m) => ({
    default: m.ImageCaptionComposer,
  })),
);

const LazyVoiceRecordComposer = lazy(() =>
  import("@/components/messages/VoiceRecordComposer").then((m) => ({
    default: m.VoiceRecordComposer,
  })),
);

const LazyMoneyReceiptClaimSheet = lazy(() =>
  import("@/components/messages/MoneyReceiptClaimSheet").then((m) => ({
    default: m.MoneyReceiptClaimSheet,
  })),
);

const LazyChatThreadMoneyModal = lazy(() =>
  import("@/components/messages/ChatThreadMoneyModal"),
);

type AttachProps = ComponentProps<
  typeof import("@/components/messages/ChatAttachSheet").ChatAttachSheet
>;
type CaptionProps = ComponentProps<
  typeof import("@/components/messages/ImageCaptionComposer").ImageCaptionComposer
>;
type VoiceRecProps = ComponentProps<
  typeof import("@/components/messages/VoiceRecordComposer").VoiceRecordComposer
>;
type ReceiptClaimProps = ComponentProps<
  typeof import("@/components/messages/MoneyReceiptClaimSheet").MoneyReceiptClaimSheet
>;

function PanelSpinner({ accent }: { accent: string }) {
  return (
    <View style={{ padding: 24, alignItems: "center" }}>
      <ActivityIndicator color={accent} />
    </View>
  );
}

export function prefetchChatThreadDeferredUi(): void {
  void import("@/components/messages/ChatAttachSheet");
  void import("@/components/messages/ChatThreadMoneyModal");
}

export function DeferredChatAttachSheet(props: AttachProps) {
  if (!props.visible) return null;
  return (
    <Suspense fallback={null}>
      <LazyChatAttachSheet {...props} />
    </Suspense>
  );
}

export function DeferredImageCaptionComposer(props: CaptionProps) {
  return (
    <Suspense fallback={<PanelSpinner accent={props.colors.accent} />}>
      <LazyImageCaptionComposer {...props} />
    </Suspense>
  );
}

export function DeferredVoiceRecordComposer(props: VoiceRecProps) {
  return (
    <Suspense fallback={<PanelSpinner accent={props.colors.accent} />}>
      <LazyVoiceRecordComposer {...props} />
    </Suspense>
  );
}

export function DeferredMoneyReceiptClaimSheet(props: ReceiptClaimProps) {
  if (!props.visible) return null;
  return (
    <Suspense fallback={null}>
      <LazyMoneyReceiptClaimSheet {...props} />
    </Suspense>
  );
}

export function DeferredChatMoneyModal(props: ChatThreadMoneyModalProps) {
  if (!props.visible) return null;
  return (
    <Suspense fallback={null}>
      <LazyChatThreadMoneyModal {...props} />
    </Suspense>
  );
}

/** Précharge pay / attach au 1er tap sur 💰 ou pièce jointe. */
export function warmChatMoneyModalChunk(): void {
  void import("@/components/messages/ChatThreadMoneyModal");
}

export function warmChatAttachChunk(): void {
  void import("@/components/messages/ChatAttachSheet");
}

export function warmChatVoiceComposerChunk(): void {
  void import("@/components/messages/VoiceRecordComposer");
}
