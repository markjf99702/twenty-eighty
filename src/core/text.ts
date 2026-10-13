/**
 * "a" or "an" before a number, the way it's read aloud: an 8-year deal, an
 * 11-game streak, an 85 wRC+, an 8.31 ERA, but a 10-year deal, a 105 wRC+ and
 * a 4.50 ERA. Give it the number as it will be printed.
 */
export function article(n: number | string): "a" | "an" {
  const digits = /^\d[\d,]*/.exec(String(n))?.[0].replace(/,/g, "");
  if (!digits) return "a";
  // The group said first: eight, eleven, eighteen, eighty-something, eight hundred (8,000 and 11,500 too).
  const lead = Number(digits.slice(0, digits.length % 3 || 3));
  return lead === 8 || lead === 11 || lead === 18 || (lead >= 80 && lead < 90) || (lead >= 800 && lead < 900) ? "an" : "a";
}

/** The number with its article: "an 8", "a 10", "an 8.31". */
export const withArticle = (n: number | string): string => `${article(n)} ${n}`;
