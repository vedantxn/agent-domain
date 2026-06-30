import type { RegistrarPrice } from "../types.js";
import { getPricingData } from "./cache.js";

export async function getPricing(tld: string): Promise<RegistrarPrice[]> {
  const { data } = await getPricingData();
  if (!data) return [];

  const normalized = tld.replace(/^\./, "").toLowerCase();
  const tldData = data.tlds[normalized];
  if (!tldData) return [];

  return [...tldData.prices].sort(
    (a, b) => a.year1_usd_cents - b.year1_usd_cents
  );
}

export { getPricingData } from "./cache.js";
