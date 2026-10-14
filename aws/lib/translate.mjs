import {
  TranslateClient,
  TranslateTextCommand,
} from "@aws-sdk/client-translate";

const client = new TranslateClient({});

const AWS_SUPPORTED = new Set([
  "af",
  "sq",
  "am",
  "ar",
  "hy",
  "az",
  "bn",
  "bs",
  "bg",
  "ca",
  "zh",
  "zh-TW",
  "hr",
  "cs",
  "da",
  "fa-AF",
  "nl",
  "en",
  "et",
  "fi",
  "fr",
  "fr-CA",
  "ka",
  "de",
  "el",
  "gu",
  "ht",
  "ha",
  "he",
  "hi",
  "hu",
  "is",
  "id",
  "ga",
  "it",
  "ja",
  "kn",
  "kk",
  "ko",
  "lv",
  "lt",
  "mk",
  "ms",
  "ml",
  "mt",
  "mr",
  "mn",
  "no",
  "ps",
  "pl",
  "pt",
  "pt-PT",
  "pa",
  "ro",
  "ru",
  "sr",
  "si",
  "sk",
  "sl",
  "so",
  "es",
  "es-MX",
  "sw",
  "sv",
  "tl",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "cy",
]);

export function normalizeTranslateTargetLanguage(raw) {
  const s = String(raw ?? "en").trim();
  if (!s) return "en";
  const lower = s.toLowerCase();
  if (lower === "zh-tw" || lower === "zh_hant") return "zh-TW";
  if (lower.startsWith("zh")) return "zh";
  if (lower === "pt-br") return "pt";
  if (lower === "pt-pt") return "pt-PT";
  if (lower === "en-us" || lower === "en-gb") return "en";
  if (lower === "fr-fr" || lower === "fr-ca") {
    return lower === "fr-ca" ? "fr-CA" : "fr";
  }
  const base = lower.split(/[-_]/)[0];
  const candidate = AWS_SUPPORTED.has(s) ? s : base;
  if (AWS_SUPPORTED.has(candidate)) return candidate;
  if (AWS_SUPPORTED.has(base)) return base;
  return "en";
}

function textsEqual(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

export async function translateTextBatch(items, targetLanguage) {
  const target = normalizeTranslateTargetLanguage(targetLanguage);
  const out = [];
  for (const row of items) {
    const id = String(row?.id ?? "").trim();
    const text = String(row?.text ?? "");
    if (!id || !text.trim()) {
      out.push({ id, translatedText: text, skipped: true });
      continue;
    }
    if (text.length > 5000) {
      out.push({ id, translatedText: text.slice(0, 5000), skipped: true });
      continue;
    }
    try {
      const res = await client.send(
        new TranslateTextCommand({
          Text: text,
          SourceLanguageCode: "auto",
          TargetLanguageCode: target,
        }),
      );
      const translated = String(res.TranslatedText ?? text);
      const source = res.SourceLanguageCode
        ? String(res.SourceLanguageCode)
        : null;
      const skipped =
        textsEqual(translated, text) ||
        (source && source.toLowerCase() === target.toLowerCase());
      out.push({
        id,
        translatedText: translated,
        sourceLanguage: source,
        skipped,
      });
    } catch (err) {
      console.error("[translate]", id, err);
      out.push({ id, translatedText: text, error: true });
    }
  }
  return { targetLanguage: target, items: out };
}
