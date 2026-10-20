import { MessageBubbleMetaRow } from "@/components/messages/MessageBubbleMeta";
import React from "react";
import { Text, View } from "react-native";

type MetaProps = React.ComponentProps<typeof MessageBubbleMetaRow>;

type Props = {
  fruitEmoji: string;
  mine: boolean;
  claimingThis: boolean;
  styles: Record<string, object>;
  metaTextProps: MetaProps;
};

/** Paiement « fruit » — visuel emoji, sans bulle wallet. */
export function FruitMoneyBubble({
  fruitEmoji,
  mine,
  claimingThis,
  styles,
  metaTextProps,
}: Props) {
  return (
    <View
      style={[
        styles.jumboEmojiWrap,
        mine && styles.jumboEmojiWrapMine,
        styles.fruitMoneyWrap,
      ]}
    >
      <Text
        style={[
          styles.fruitMoneyEmojiJumbo,
          claimingThis && { opacity: 0.55 },
        ]}
      >
        {fruitEmoji}
      </Text>
      <View style={styles.fruitMoneyMetaRow} pointerEvents="none">
        <MessageBubbleMetaRow {...metaTextProps} bare fruitMoneyMeta />
      </View>
    </View>
  );
}
