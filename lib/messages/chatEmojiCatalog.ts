/** Catégories Unicode (même découpage que WhatsApp / claviers système). */

export type ChatEmojiCategoryId =
  | "recent"
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
};

type RawGroup = {
  slug: string;
  emojis: { emoji: string }[];
};

const SLUG_TO_META: Record<
  Exclude<ChatEmojiCategoryId, "recent">,
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

let cached: ChatEmojiCategory[] | null = null;

export async function loadChatEmojiCategories(): Promise<ChatEmojiCategory[]> {
  if (cached) return cached;
  const mod = await import("unicode-emoji-json/data-by-group.json");
  const groups = (mod.default ?? mod) as RawGroup[];
  const out: ChatEmojiCategory[] = [];
  for (const g of groups) {
    const slug = g.slug as Exclude<ChatEmojiCategoryId, "recent">;
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
  cached = out;
  return out;
}

export const RECENT_EMOJI_CATEGORY: ChatEmojiCategory = {
  id: "recent",
  labelKey: "messages.emojiCat.recent",
  icon: "time-outline",
  emojis: [],
};
