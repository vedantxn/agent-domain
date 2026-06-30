#!/usr/bin/env node

/**
 * Pricing scraper — runs hourly in CI and writes data/pricing.json.
 * Source: Porkbun's public pricing endpoint (no API keys required).
 *
 * Usage: node scripts/scrape-pricing.mjs
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "data", "pricing.json");

async function scrapePorkbun() {
  const apiKey = process.env.PORKBUN_API_KEY;
  const secret = process.env.PORKBUN_SECRET;

  // pricing/get is a public endpoint: it returns the full TLD price list with
  // no authentication. We send credentials only if they happen to be set
  // (harmless, and ready for any future authenticated endpoints).
  const body =
    apiKey && secret ? { apikey: apiKey, secretapikey: secret } : {};

  try {
    const res = await fetch("https://api.porkbun.com/api/json/v3/pricing/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.warn(`PORKBUN: API returned ${res.status}`);
      return null;
    }

    const data = await res.json();
    if (data.status !== "SUCCESS" || !data.pricing) {
      console.warn("PORKBUN: unexpected response format");
      return null;
    }

    const results = {};
    for (const [tld, info] of Object.entries(data.pricing)) {
      results[tld] = {
        registrar: "porkbun",
        year1_usd_cents: Math.round(parseFloat(info.registration) * 100),
        renewal_usd_cents: Math.round(parseFloat(info.renewal) * 100),
        transfer_usd_cents: Math.round(parseFloat(info.transfer) * 100),
        url: "https://porkbun.com",
      };
    }

    console.log(`PORKBUN: scraped ${Object.keys(results).length} TLDs`);
    return results;
  } catch (err) {
    console.warn(`PORKBUN: error - ${err.message}`);
    return null;
  }
}

/**
 * True when two price entries carry identical pricing (timestamps ignored).
 * Used to decide whether `price_updated_at` should advance.
 */
export function pricesEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.registrar === b.registrar &&
    a.year1_usd_cents === b.year1_usd_cents &&
    a.renewal_usd_cents === b.renewal_usd_cents &&
    a.transfer_usd_cents === b.transfer_usd_cents &&
    (a.url ?? null) === (b.url ?? null)
  );
}

/**
 * Latest valid ISO timestamp among the given prices, or `fallback` if none.
 * Lets top-level `updated_at` mean "pricing last changed", not "last fetched".
 */
function maxPriceTimestamp(tlds, fallback) {
  let maxMs = -Infinity;
  let maxIso = null;
  for (const { prices } of Object.values(tlds)) {
    for (const p of prices) {
      const ms = Date.parse(p.price_updated_at);
      if (!Number.isNaN(ms) && ms > maxMs) {
        maxMs = ms;
        maxIso = p.price_updated_at;
      }
    }
  }
  return maxIso ?? fallback;
}

/**
 * Merge freshly-scraped registrar prices (no timestamps) into the existing
 * dataset. A price keeps its prior `price_updated_at` when unchanged and only
 * advances to `now` when the price actually moved. This keeps the committed
 * file byte-stable across runs where nothing changed, so the workflow's
 * change-detection commits only on real price movement.
 *
 * @param existing  prior pricing.json contents (or null on first run)
 * @param scraped   { [registrar]: { [tld]: priceWithoutTimestamp } | null }
 * @param now       ISO timestamp to stamp on changed/new prices
 */
export function mergePricing(existing, scraped, now) {
  const tlds = {};
  const registrars = new Set(existing?.registrars || []);

  // Seed from existing data, preserving its timestamps.
  if (existing?.tlds) {
    for (const [tld, data] of Object.entries(existing.tlds)) {
      tlds[tld] = { prices: data.prices.map((p) => ({ ...p })) };
    }
  }

  for (const [registrar, byTld] of Object.entries(scraped)) {
    if (!byTld) continue;
    registrars.add(registrar);
    for (const [tld, price] of Object.entries(byTld)) {
      if (!tlds[tld]) tlds[tld] = { prices: [] };
      const prior = tlds[tld].prices.find((p) => p.registrar === registrar);
      const price_updated_at =
        prior && pricesEqual(prior, price) ? prior.price_updated_at : now;
      tlds[tld].prices = tlds[tld].prices.filter(
        (p) => p.registrar !== registrar
      );
      tlds[tld].prices.push({ ...price, price_updated_at });
    }
  }

  // Sort prices within each TLD (cheapest first).
  for (const tld of Object.keys(tlds)) {
    tlds[tld].prices.sort((a, b) => a.year1_usd_cents - b.year1_usd_cents);
  }

  return {
    version: 1,
    updated_at: maxPriceTimestamp(tlds, now),
    registrars: [...registrars].sort(),
    tlds,
  };
}

async function main() {
  console.log("Starting pricing scrape...\n");

  const now = new Date().toISOString();

  // Load existing data as fallback
  let existing = null;
  try {
    existing = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
  } catch {
    // No existing data
  }

  const porkbunData = await scrapePorkbun();

  const output = mergePricing(existing, { porkbun: porkbunData }, now);

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(
    `\nDone. Wrote ${Object.keys(output.tlds).length} TLDs to ${OUTPUT_PATH}`
  );
}

// Only run when invoked directly, so tests can import the pure helpers above.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
