import { parseAmountFcfa } from "@/lib/amountLimits";

export type ComposerMoneyDraft = {
  amountFcfa: number;
  caption: string;
};

/**
 * Token `**` + montant (ex. `**100`, `**100F`) n’importe où dans le composer.
 */
const COMPOSER_MONEY_TOKEN =
  /\*\*([\d][\d\s\u00A0]{0,14}\d|\d)\s*(?:fcfa|cfa|f)?(?=\s|$|[^a-zA-ZÀ-ÿ])/gi;

function normalizeCaption(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function findSingleValidMoneyToken(text: string): RegExpMatchArray | null {
  if (!text.includes("**")) return null;
  COMPOSER_MONEY_TOKEN.lastIndex = 0;
  const matches = [...text.matchAll(COMPOSER_MONEY_TOKEN)];
  if (matches.length !== 1) return null;
  const m = matches[0];
  if (parseAmountFcfa(m[1] ?? "") == null) return null;
  return m;
}

export function parseComposerMoneyDraft(raw: string): ComposerMoneyDraft | null {
  const text = String(raw ?? "");
  const m = findSingleValidMoneyToken(text);
  if (!m) return null;

  const full = m[0];
  const start = m.index ?? -1;
  if (start < 0 || !full) return null;

  const amountFcfa = parseAmountFcfa(m[1] ?? "");
  if (amountFcfa == null) return null;

  const before = text.slice(0, start);
  const after = text.slice(start + full.length);
  const caption = normalizeCaption(`${before} ${after}`);

  return { amountFcfa, caption };
}

export function composerTextLooksLikeMoneyDraft(raw: string): boolean {
  return parseComposerMoneyDraft(raw) != null;
}
