/** Catégories Unicode (même découpage que WhatsApp / claviers système). */

import {
  CHAT_MONEY_DENOMS,
  type ChatMoneyDenom,
} from "@/lib/messages/chatMoneyDenoms";

export type ChatEmojiCategoryId =
  | "recent"
  | "money"
  | "smileys_emotion"
  | "people_body"
  | "animals_nature"
  | "food_drink"
  | "travel_places"
  | "activities"
  | "objects"
  | "symbols"
  | "flags";

export type ChatEmojiCategory = {
  id: ChatEmojiCategoryId;
  /** Clé i18n `messages.emojiCat.*` */
  labelKey: string;
  icon: string;
  emojis: string[];
  /** Pièces / billets FCFA (onglet Argent uniquement). */
  moneyDenoms?: ChatMoneyDenom[];
};

type RawGroup = {
  slug: string;
  emojis: { emoji: string }[];
};

const SLUG_TO_META: Record<
  Exclude<ChatEmojiCategoryId, "recent" | "money">,
  { labelKey: string; icon: string }
> = {
  smileys_emotion: {
    labelKey: "messages.emojiCat.smileys",
    icon: "happy-outline",
  },
  people_body: { labelKey: "messages.emojiCat.people", icon: "body-outline" },
  animals_nature: {
    labelKey: "messages.emojiCat.nature",
    icon: "leaf-outline",
  },
  food_drink: {
    labelKey: "messages.emojiCat.food",
    icon: "restaurant-outline",
  },
  travel_places: {
    labelKey: "messages.emojiCat.travel",
    icon: "airplane-outline",
  },
  activities: {
    labelKey: "messages.emojiCat.activities",
    icon: "football-outline",
  },
  objects: { labelKey: "messages.emojiCat.objects", icon: "gift-outline" },
  symbols: { labelKey: "messages.emojiCat.symbols", icon: "heart-outline" },
  flags: { labelKey: "messages.emojiCat.flags", icon: "flag-outline" },
};

/** Argent / paiements — section dédiée (wallet Blyp). */
export const CHAT_MONEY_EMOJI_CATEGORY: ChatEmojiCategory = {
  id: "money",
  labelKey: "messages.emojiCat.money",
  icon: "cash-outline",
  moneyDenoms: CHAT_MONEY_DENOMS,
  emojis: ["💰", "🤝", "🙏", "🎁", "🛒", "✅", "🎉"],
};

let cached: ChatEmojiCategory[] | null = null;

/** Metro/Android : `import()` sur ce JSON casse souvent (module id inconnu) — `require` fiable. */
function loadUnicodeEmojiGroups(): RawGroup[] {
  return require("unicode-emoji-json/data-by-group.json") as RawGroup[];
}

export async function loadChatEmojiCategories(): Promise<ChatEmojiCategory[]> {
  if (cached) return cached;
  const groups = loadUnicodeEmojiGroups();
  const out: ChatEmojiCategory[] = [];
  for (const g of groups) {
    const slug = g.slug as Exclude<ChatEmojiCategoryId, "recent" | "money">;
    const meta = SLUG_TO_META[slug];
    if (!meta) continue;
    const emojis: string[] = [];
    for (const row of g.emojis ?? []) {
      const ch = String(row.emoji ?? "").trim();
      if (ch) emojis.push(ch);
    }
    out.push({
      id: slug,
      labelKey: meta.labelKey,
      icon: meta.icon,
      emojis,
    });
  }
  const withMoney: ChatEmojiCategory[] = [];
  for (const cat of out) {
    withMoney.push(cat);
    if (cat.id === "smileys_emotion") {
      withMoney.push(CHAT_MONEY_EMOJI_CATEGORY);
    }
  }
  if (!withMoney.some((c) => c.id === "money")) {
    withMoney.unshift(CHAT_MONEY_EMOJI_CATEGORY);
  }
  cached = withMoney;
  return withMoney;
}

export const RECENT_EMOJI_CATEGORY: ChatEmojiCategory = {
  id: "recent",
  labelKey: "messages.emojiCat.recent",
  icon: "time-outline",
  emojis: [],
};
