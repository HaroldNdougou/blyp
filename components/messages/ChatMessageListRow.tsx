import { DocumentBubble } from "@/components/messages/DocumentBubble";
import { FruitMoneyBubble } from "@/components/messages/FruitMoneyBubble";
import { ImageBubble } from "@/components/messages/ImageBubble";
import { MessageReplyQuote } from "@/components/messages/MessageReplyQuote";
import { MessageBubbleMetaRow } from "@/components/messages/MessageBubbleMeta";
import { ReactionBadge } from "@/components/messages/MessageReactions";
import { SwipeToReplyWrap } from "@/components/messages/SwipeToReplyWrap";
import { MessageForwardedLabel } from "@/components/messages/MessageForwardedLabel";
import { MessageTranslatedText } from "@/components/messages/MessageTranslatedText";
import { VoiceBubble } from "@/components/messages/VoiceBubble";
import type { createMessagesStyles } from "@/components/messages/messagesStyles";
import type { ChatMessage } from "@/lib/api/types";
import { formatMessageDayLabel } from "@/lib/format";
import { formatFcfa } from "@/lib/formatFcfa";
import {
  moneyAmountColor,
  moneyExpiresLine,
  moneyStatusText,
  messageRowContentKey,
  thanksLabel,
  tickForMessage,
} from "@/lib/messages/chatMessageRowModel";
import { CHAT_LONG_PRESS_MS } from "@/lib/messages/chatEmojiConstants";
import {
  jumboEmojiFontSize,
  jumboEmojiLineHeight,
  parseJumboEmojiBody,
} from "@/lib/messages/jumboEmoji";
import { fireChatLongPressHaptic } from "@/lib/messages/chatLongPressHaptic";
import { unpackReceiptGeneration } from "@/lib/messages/receiptGeneration";
import { getMessageReplyTo } from "@/lib/messages/replyPreview";
import type { ThemeColors } from "@/lib/theme/colors";
import { formatVoiceClock } from "@/lib/voice/formatVoiceClock";
import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

export type ChatMessageRowHandlers = {
  openReactPicker: (messageId: string) => void;
  toggleMessageSelection: (messageId: string) => void;
  notifyMessageRowTouch: () => void;
  closeReactPicker: () => void;
  startReplyTo: (msg: ChatMessage) => void;
  scrollToMessageId: (messageId: string) => void;
  onClaim: (transferId: string, mine: boolean) => void;
  onBeginReceiptClaim: (transferId: string) => void;
  onToggleMoneyReceipt: (transferId: string, required: boolean) => void;
  setRecallTransferId: (transferId: string) => void;
  dismissHighlight: () => void;
  applyReaction: (msg: ChatMessage, emoji: string) => void;
  playVoiceMsg: (msg: ChatMessage) => void;
};

export type ChatMessageListRowProps = {
  item: ChatMessage;
  showDate: boolean;
  mine: boolean;
  selected: boolean;
  selectionActive: boolean;
  highlighted: boolean;
  newArrival: boolean;
  claimingThis: boolean;
  showClaim: boolean;
  peerName: string;
  myId: string | null;
  conversationId: string;
  token: string | null;
  receiptGeneration: string;
  highlightedTransferId: string | null;
  colors: ThemeColors;
  styles: ReturnType<typeof createMessagesStyles>;
  handlersRef: React.MutableRefObject<ChatMessageRowHandlers>;
  registerReactAnchor: (messageId: string, node: View | null) => void;
  /** Traductions des messages reçus (id → texte dans la langue du téléphone). */
  peerTranslations?: Record<string, string>;
};

function ChatMessageListRowInner({
  item,
  showDate,
  mine,
  selected,
  selectionActive,
  highlighted,
  newArrival,
  claimingThis,
  showClaim,
  peerName,
  myId,
  conversationId,
  token,
  receiptGeneration,
  highlightedTransferId,
  colors,
  styles,
  handlersRef,
  registerReactAnchor,
  peerTranslations,
}: ChatMessageListRowProps) {
  const { t } = useTranslation();
  const { peerLastReadAt, peerLastDeliveredAt } =
    unpackReceiptGeneration(receiptGeneration);

  const deleted = Boolean(item.deletedForAll);
  const forwarded = Boolean(item.forwarded) && !deleted;
  const forwardedLabel = forwarded ? (
    <MessageForwardedLabel mine={mine} styles={styles} />
  ) : null;
  const isMoney = !deleted && item.type === "money" && item.moneyTransfer;
  const isVoice = !deleted && item.type === "voice" && item.voice;
  const isImage = !deleted && item.type === "image" && item.image;
  const isDocument = !deleted && item.type === "document" && item.document;
  const jumbo =
    !deleted && !isMoney && !isVoice && !isImage && !isDocument
      ? parseJumboEmojiBody(item.body)
      : null;
  const tr = item.moneyTransfer;
  const fruitMoneyEmoji =
    isMoney && tr && item.moneyFruitEmoji ? item.moneyFruitEmoji : null;
  const recipientMe = isMoney ? !mine : false;
  const statusTxt = tr ? moneyStatusText(tr, recipientMe, mine, peerName, t) : "";
  const thanksTxt = tr ? thanksLabel(tr, recipientMe, peerName, t) : "";
  const expiresTxt = tr ? moneyExpiresLine(tr, t) : "";
  const amountLabel = tr
    ? `${formatFcfa(tr.amountFcfa)} ${t("common.fcfa")}`
    : "";
  const moneyCaption = isMoney ? String(item.body ?? "").trim() : "";
  const peerTranslation = peerTranslations?.[item.id];
  const body = deleted
    ? mine
      ? t("messages.deletedForAllMine")
      : t("messages.deletedForAllTheirs")
    : isMoney
      ? amountLabel
      : (item.body ?? "");
  const amountColor =
    isMoney && tr ? moneyAmountColor(tr, mine, colors) : undefined;
  const voiceTime = item.voice ? formatVoiceClock(item.voice.durationMs) : "";
  const a11y = isImage
    ? t("messages.imageA11y")
    : isDocument
      ? t("messages.documentOpenA11y", {
          name: item.document?.fileName ?? "",
        })
    : isVoice
      ? t("messages.voiceA11y", { time: voiceTime })
      : isMoney && tr && fruitMoneyEmoji
        ? showClaim
          ? t(mine ? "messages.reclaimTapA11y" : "messages.claimTapA11y", {
              amount: formatFcfa(tr.amountFcfa),
            })
          : t("messages.fruitMoneyA11y", {
              amount: formatFcfa(tr.amountFcfa),
              fruit: fruitMoneyEmoji,
            })
      : isMoney && tr
        ? showClaim
          ? t(mine ? "messages.reclaimTapA11y" : "messages.claimTapA11y", {
              amount: formatFcfa(tr.amountFcfa),
            })
          : `${amountLabel}, ${statusTxt}${expiresTxt ? `, ${expiresTxt}` : ""}`
        : undefined;

  const canReact = !item.id.startsWith("c-") && !deleted;
  const itemReplyTo = deleted ? null : getMessageReplyTo(item);
  const replyQuoteEl = itemReplyTo ? (
    <MessageReplyQuote
      replyTo={itemReplyTo}
      mine={mine}
      myId={myId}
      peerName={peerName}
      styles={styles}
      onPress={() =>
        handlersRef.current.scrollToMessageId(itemReplyTo.messageId)
      }
    />
  ) : null;

  const tick = mine
    ? tickForMessage(item, peerLastReadAt, peerLastDeliveredAt)
    : null;

  const fruitMoneyClaimedLabel =
    fruitMoneyEmoji && tr && tr.status === "claimed"
      ? t("messages.fruitMoneyClaimedMeta")
      : null;

  const moneyPending = Boolean(isMoney && tr && tr.status === "pending");
  const showMoneyReceiptMeta = moneyPending && !fruitMoneyEmoji;
  const triggerMoneyReceiptToggle = () => {
    if (!showMoneyReceiptMeta || !tr || !mine) return;
    handlersRef.current.onToggleMoneyReceipt(
      tr.transferId,
      !tr.receiptRequired,
    );
  };

  const metaTextProps = {
    createdAt: item.createdAt,
    mine,
    tick,
    colors,
    styles,
    deletedForAll: deleted && mine,
    fruitMoneyClaimedLabel,
    moneyReceiptToggle:
      showMoneyReceiptMeta && mine
        ? {
            on: Boolean(tr?.receiptRequired),
            onPress: triggerMoneyReceiptToggle,
            disabled: claimingThis,
          }
        : undefined,
    moneyReceiptOn:
      showMoneyReceiptMeta && !mine ? Boolean(tr?.receiptRequired) : undefined,
  };

  const detachMoneyReceiptMeta = Boolean(isMoney && tr && !fruitMoneyEmoji && !deleted);
  const moneyMetaRow = <MessageBubbleMetaRow {...metaTextProps} />;

  const renderImageOverlayMeta = () => (
    <View>
      <View style={styles.imageMetaScrim} />
      <View style={styles.imageMetaRow}>
        <MessageBubbleMetaRow {...metaTextProps} imageOverlay bare />
      </View>
    </View>
  );

  const imageCaption = isImage ? String(item.body ?? "").trim() : "";
  const documentCaption = isDocument ? String(item.body ?? "").trim() : "";

  const triggerReactPicker = () => {
    fireChatLongPressHaptic();
    handlersRef.current.openReactPicker(item.id);
  };

  const triggerMoneyClaim = () => {
    if (!showClaim || !tr || claimingThis) return;
    const handler = handlersRef.current;
    if (mine) {
      handler.setRecallTransferId(tr.transferId);
      return;
    }
    if (tr.receiptRequired) {
      handler.onBeginReceiptClaim(tr.transferId);
      return;
    }
    void handler.onClaim(tr.transferId, false);
  };

  const replyInnerStyle = itemReplyTo ? styles.bubbleReplyInner : undefined;
  const translatedPeerText = Boolean(!mine && peerTranslation);
  const textStackStyle = itemReplyTo
    ? styles.bubbleTextStackInReply
    : translatedPeerText
      ? styles.bubbleTextStackTranslate
      : styles.bubbleTextStack;

  const bubbleBody = isImage ? (
    <>
      {forwardedLabel}
      {replyQuoteEl ? (
        <View style={styles.bubbleImageReplyPad}>{replyQuoteEl}</View>
      ) : null}
      <ImageBubble
        message={item}
        conversationId={conversationId}
        token={token}
        styles={styles}
        overlayMeta={imageCaption ? undefined : renderImageOverlayMeta()}
        onLongPress={triggerReactPicker}
        delayLongPress={CHAT_LONG_PRESS_MS}
      />
      {imageCaption ? (
        <View style={styles.bubbleImageCaption}>
          <View style={styles.bubbleTextStack}>
            <MessageTranslatedText
              original={imageCaption}
              translated={peerTranslation}
              mine={mine}
              colors={colors}
              styles={styles}
              textStyle={[
                styles.bubbleText,
                mine ? styles.bubbleTextMine : styles.bubbleTextTheirs,
              ]}
            />
            <MessageBubbleMetaRow {...metaTextProps} />
          </View>
        </View>
      ) : null}
    </>
  ) : isDocument ? (
    <>
      {forwardedLabel}
      {replyQuoteEl}
      <DocumentBubble
        message={item}
        conversationId={conversationId}
        token={token}
        mine={mine}
        colors={colors}
        styles={styles}
        selectionActive={selectionActive}
        onSelectionPress={() =>
          handlersRef.current.toggleMessageSelection(item.id)
        }
        onLongPress={triggerReactPicker}
        delayLongPress={CHAT_LONG_PRESS_MS}
      />
      {documentCaption ? (
        <View style={styles.bubbleImageCaption}>
          <View style={styles.bubbleTextStack}>
            <MessageTranslatedText
              original={documentCaption}
              translated={peerTranslation}
              mine={mine}
              colors={colors}
              styles={styles}
              textStyle={[
                styles.bubbleText,
                mine ? styles.bubbleTextMine : styles.bubbleTextTheirs,
              ]}
            />
            <MessageBubbleMetaRow {...metaTextProps} />
          </View>
        </View>
      ) : (
        <MessageBubbleMetaRow {...metaTextProps} />
      )}
    </>
  ) : (
    <>
      {forwardedLabel}
      {replyQuoteEl}
      {isVoice ? (
        <VoiceBubble
          message={item}
          durationMs={item.voice?.durationMs ?? 0}
          ink={mine ? colors.bubbleMineText : colors.bubbleTheirsText}
          styles={styles}
          onToggle={handlersRef.current.playVoiceMsg}
          metaTextProps={metaTextProps}
        />
      ) : jumbo ? (
        <View
          style={[
            styles.jumboEmojiWrap,
            mine && styles.jumboEmojiWrapMine,
          ]}
        >
          <Text
            style={[
              styles.jumboEmojiText,
              {
                fontSize: jumboEmojiFontSize(jumbo.count),
                lineHeight: jumboEmojiLineHeight(jumbo.count),
              },
            ]}
          >
            {jumbo.text}
          </Text>
          <View style={styles.jumboEmojiMetaSlot} pointerEvents="none">
            <View style={styles.jumboEmojiMetaScrim} />
            <MessageBubbleMetaRow {...metaTextProps} imageOverlay bare />
          </View>
        </View>
      ) : fruitMoneyEmoji && tr ? (
        <FruitMoneyBubble
          fruitEmoji={fruitMoneyEmoji}
          mine={mine}
          claimingThis={claimingThis}
          styles={styles}
          metaTextProps={metaTextProps}
        />
      ) : (
        <View style={textStackStyle}>
          {deleted || isMoney ? (
            <Text
              style={[
                deleted
                  ? styles.bubbleTextDeleted
                  : styles.moneyAmountText,
                !deleted &&
                  !isMoney &&
                  (mine ? styles.bubbleTextMine : styles.bubbleTextTheirs),
                amountColor ? { color: amountColor } : null,
                claimingThis && { opacity: 0.55 },
              ]}
            >
              {body}
              {isMoney && tr ? (
                <>
                  {showClaim ? (
                    <Text style={styles.bubbleMetaTime}>
                      {"\n💰 "}
                      <Text
                        onPress={triggerMoneyClaim}
                        suppressHighlighting={false}
                        style={[
                          styles.bubbleMetaTime,
                          { color: colors.moneyClaimAction },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={
                          mine
                            ? t("messages.reclaimTapA11y", {
                                amount: formatFcfa(tr.amountFcfa),
                              })
                            : t("messages.claimTapA11y", {
                                amount: formatFcfa(tr.amountFcfa),
                              })
                        }
                      >
                        {t(mine ? "messages.reclaim" : "messages.claim")}
                      </Text>
                    </Text>
                  ) : (
                    <Text
                      style={[
                        styles.bubbleMetaTime,
                        tr.status !== "pending" && amountColor
                          ? { color: amountColor }
                          : null,
                      ]}
                    >
                      {`\n💰 ${statusTxt}`}
                    </Text>
                  )}
                  {expiresTxt ? (
                    <Text style={styles.bubbleMetaTime}>{`\n${expiresTxt}`}</Text>
                  ) : null}
                </>
              ) : null}
            </Text>
          ) : (
            <MessageTranslatedText
              original={body}
              translated={peerTranslation}
              mine={mine}
              colors={colors}
              styles={styles}
              textStyle={[
                styles.bubbleText,
                mine ? styles.bubbleTextMine : styles.bubbleTextTheirs,
                claimingThis && { opacity: 0.55 },
              ]}
            />
          )}
          {!detachMoneyReceiptMeta ? moneyMetaRow : null}
        </View>
      )}
      {isMoney && moneyCaption && !fruitMoneyEmoji ? (
        <View style={styles.bubbleImageCaption}>
          <MessageTranslatedText
            original={moneyCaption}
            translated={peerTranslation}
            mine={mine}
            colors={colors}
            styles={styles}
            textStyle={[
              styles.bubbleText,
              mine ? styles.bubbleTextMine : styles.bubbleTextTheirs,
            ]}
          />
        </View>
      ) : null}
    </>
  );

  const bubbleShellStyle = [
    styles.bubble,
    isVoice && styles.bubbleVoice,
    isImage && styles.bubbleImage,
    itemReplyTo && styles.bubbleHasReply,
    !isImage &&
      !isDocument &&
      (fruitMoneyEmoji
        ? styles.bubbleFruitMoney
        : jumbo
          ? styles.bubbleJumbo
          : mine
            ? styles.bubbleMine
            : styles.bubbleTheirs),
    (isImage || isDocument) &&
      (mine ? styles.bubbleMine : styles.bubbleTheirs),
    highlighted && !fruitMoneyEmoji && styles.bubbleHighlight,
    newArrival && !highlighted && !fruitMoneyEmoji && styles.bubbleNewArrival,
  ];

  const bubbleInner = replyInnerStyle ? (
    <View style={replyInnerStyle}>{bubbleBody}</View>
  ) : (
    bubbleBody
  );

  const bubble = (
    <View style={bubbleShellStyle}>
      {bubbleInner}
      {detachMoneyReceiptMeta ? moneyMetaRow : null}
    </View>
  );

  const h = handlersRef.current;

  const onBubblePress = () => {
    if (selectionActive) {
      h.toggleMessageSelection(item.id);
      return;
    }
    if (highlighted) return;
    if (highlightedTransferId) {
      h.dismissHighlight();
      return;
    }
    if (showClaim && tr && fruitMoneyEmoji) {
      triggerMoneyClaim();
    }
  };

  return (
    <View>
      {showDate ? (
        <View style={styles.dateChipWrap}>
          <View style={styles.dateChip}>
            <Text style={styles.dateChipText}>
              {formatMessageDayLabel(item.createdAt)}
            </Text>
          </View>
        </View>
      ) : null}
      <View
        style={[
          styles.messageSelectRowWrap,
          itemReplyTo && styles.messageSelectRowReply,
        ]}
        onTouchStartCapture={() => {
          h.notifyMessageRowTouch();
        }}
      >
        <View
          style={[
            styles.bubbleRow,
            mine ? styles.bubbleRowMine : styles.bubbleRowTheirs,
          ]}
        >
          <View
            ref={(node) => registerReactAnchor(item.id, node)}
            style={[
              styles.messageSelectHost,
              mine && styles.messageSelectHostMine,
              itemReplyTo && styles.messageSelectHostReply,
            ]}
            collapsable={false}
          >
            <View style={styles.moneyBubbleWrap}>
              <SwipeToReplyWrap
                enabled={canReact && !selectionActive}
                onReply={() => h.startReplyTo(item)}
              >
                {detachMoneyReceiptMeta ? (
                  <View style={bubbleShellStyle}>
                    <Pressable
                      style={[
                        itemReplyTo ? styles.bubblePressableInReply : undefined,
                        { alignSelf: "stretch" },
                      ]}
                      onLongPress={triggerReactPicker}
                      delayLongPress={CHAT_LONG_PRESS_MS}
                      onPress={onBubblePress}
                      disabled={
                        showClaim && claimingThis && Boolean(fruitMoneyEmoji)
                      }
                      accessibilityRole="button"
                      accessibilityLabel={a11y ?? t("messages.reactA11y")}
                    >
                      {bubbleInner}
                    </Pressable>
                    {moneyMetaRow}
                  </View>
                ) : (
                  <Pressable
                    style={itemReplyTo ? styles.bubblePressableInReply : undefined}
                    onLongPress={triggerReactPicker}
                    delayLongPress={CHAT_LONG_PRESS_MS}
                    onPress={onBubblePress}
                    disabled={
                      showClaim && claimingThis && Boolean(fruitMoneyEmoji)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={a11y ?? t("messages.reactA11y")}
                  >
                    {bubble}
                  </Pressable>
                )}
              </SwipeToReplyWrap>
              {selected ? (
                <View style={styles.messageSelectVeil} pointerEvents="none" />
              ) : null}
            </View>
            {thanksTxt && !fruitMoneyEmoji ? (
              <View
                style={[styles.thanksChip, mine && styles.thanksChipMine]}
              >
                <Text style={styles.thanksChipText} numberOfLines={1}>
                  {thanksTxt}
                </Text>
              </View>
            ) : null}
            <View style={{ alignSelf: mine ? "flex-end" : "flex-start" }}>
              <ReactionBadge
                message={item}
                myId={myId}
                styles={styles}
                onToggle={(emoji) => void h.applyReaction(item, emoji)}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function rowPropsEqual(
  a: ChatMessageListRowProps,
  b: ChatMessageListRowProps,
): boolean {
  if (a.item.id !== b.item.id) return false;
  if (messageRowContentKey(a.item) !== messageRowContentKey(b.item)) {
    return false;
  }
  if (a.showDate !== b.showDate) return false;
  if (a.mine !== b.mine) return false;
  if (a.selected !== b.selected) return false;
  if (a.selectionActive !== b.selectionActive) return false;
  if (a.highlighted !== b.highlighted) return false;
  if (a.newArrival !== b.newArrival) return false;
  if (a.claimingThis !== b.claimingThis) return false;
  if (a.showClaim !== b.showClaim) return false;
  if (a.peerName !== b.peerName) return false;
  if (a.myId !== b.myId) return false;
  if (a.conversationId !== b.conversationId) return false;
  if (a.token !== b.token) return false;
  if (a.highlightedTransferId !== b.highlightedTransferId) return false;
  if (a.styles !== b.styles) return false;
  if (a.colors !== b.colors) return false;
  if (a.handlersRef !== b.handlersRef) return false;
  if (a.registerReactAnchor !== b.registerReactAnchor) return false;
  if (a.mine && a.receiptGeneration !== b.receiptGeneration) return false;
  if (
    (a.peerTranslations?.[a.item.id] ?? "") !==
    (b.peerTranslations?.[b.item.id] ?? "")
  ) {
    return false;
  }
  return true;
}

export const ChatMessageListRow = memo(ChatMessageListRowInner, rowPropsEqual);
