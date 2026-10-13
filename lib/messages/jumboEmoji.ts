/** Messages 1–3 emojis seuls — bulle « jumbo » type WhatsApp. */

const MAX_JUMBO_EMOJI = 3;

function graphemes(text: string): string[] {
  try {
    if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
      const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
      return [...seg.segment(text)].map((part) => part.segment);
    }
  } catch {
    /* Hermes / vieux runtime */
  }
  const m = text.match(
    /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*/gu,
  );
  return m ?? (text ? [text] : []);
}

function isEmojiGrapheme(g: string): boolean {
  return /\p{Extended_Pictographic}/u.test(g);
}

export type JumboEmojiInfo = { text: string; count: number };

export function parseJumboEmojiBody(
  body: string | null | undefined,
): JumboEmojiInfo | null {
  const trimmed = String(body ?? "").trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const parts = graphemes(trimmed);
  if (parts.length < 1 || parts.length > MAX_JUMBO_EMOJI) return null;
  if (!parts.every(isEmojiGrapheme)) return null;
  const joined = parts.join("");
  if (joined !== trimmed) return null;
  return { text: joined, count: parts.length };
}

export function jumboEmojiFontSize(count: number): number {
  if (count <= 1) return 58;
  if (count === 2) return 52;
  return 46;
}

export function jumboEmojiLineHeight(count: number): number {
  if (count <= 1) return 66;
  if (count === 2) return 58;
  return 52;
}
