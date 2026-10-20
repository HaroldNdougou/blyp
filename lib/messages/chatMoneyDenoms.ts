/** Dénominations FCFA + fruit (picker emoji Argent du chat). */

export type ChatMoneyDenomKind = "coin" | "bill";

export type ChatMoneyDenom = {
  id: string;
  amountFcfa: number;
  kind: ChatMoneyDenomKind;
  fruitEmoji: string;
  /** Clé i18n `messages.emojiMoneyFruit.*` */
  fruitLabelKey: string;
};

export const CHAT_MONEY_DENOMS: ChatMoneyDenom[] = [
  {
    id: "coin-50",
    amountFcfa: 50,
    kind: "coin",
    fruitEmoji: "🍌",
    fruitLabelKey: "messages.emojiMoneyFruit.banana",
  },
  {
    id: "coin-100",
    amountFcfa: 100,
    kind: "coin",
    fruitEmoji: "🍊",
    fruitLabelKey: "messages.emojiMoneyFruit.orange",
  },
  {
    id: "coin-200",
    amountFcfa: 200,
    kind: "coin",
    fruitEmoji: "🥭",
    fruitLabelKey: "messages.emojiMoneyFruit.mango",
  },
  {
    id: "coin-500",
    amountFcfa: 500,
    kind: "coin",
    fruitEmoji: "🍈",
    fruitLabelKey: "messages.emojiMoneyFruit.papaya",
  },
  {
    id: "bill-1000",
    amountFcfa: 1000,
    kind: "bill",
    fruitEmoji: "🍍",
    fruitLabelKey: "messages.emojiMoneyFruit.pineapple",
  },
  {
    id: "bill-2000",
    amountFcfa: 2000,
    kind: "bill",
    fruitEmoji: "🍉",
    fruitLabelKey: "messages.emojiMoneyFruit.watermelon",
  },
  {
    id: "bill-5000",
    amountFcfa: 5000,
    kind: "bill",
    fruitEmoji: "🥥",
    fruitLabelKey: "messages.emojiMoneyFruit.coconut",
  },
  {
    id: "bill-10000",
    amountFcfa: 10000,
    kind: "bill",
    fruitEmoji: "🍇",
    fruitLabelKey: "messages.emojiMoneyFruit.grapes",
  },
];

export function chatMoneyDenomsByKind(kind: ChatMoneyDenomKind): ChatMoneyDenom[] {
  return CHAT_MONEY_DENOMS.filter((d) => d.kind === kind);
}

export function chatMoneyDenomForAmount(
  amountFcfa: number,
): ChatMoneyDenom | undefined {
  return CHAT_MONEY_DENOMS.find((d) => d.amountFcfa === amountFcfa);
}
