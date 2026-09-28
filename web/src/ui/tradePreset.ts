import { go } from "./router";

/** A deal to load into the trade desk when it opens for that club (from an offer, a player page or a roster). */
let preset: { partner: number; give: number[]; get: number[] } | null = null;

/** Open the trade desk with this club, with these players already in the deal. */
export function tradeFor(partner: number, get: number[] = [], give: number[] = []): void {
  preset = { partner, give, get };
  go({ page: "trades", partnerId: partner });
}

/** The deal waiting for this club, once (null if none). */
export function takePreset(partner: number): { give: number[]; get: number[] } | null {
  const p = preset && preset.partner === partner ? preset : null;
  preset = null;
  return p;
}
