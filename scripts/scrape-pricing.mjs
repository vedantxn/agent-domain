#!/usr/bin/env node

/**
 * Pricing scraper — runs in CI with maintainer's API keys.
 * Fetches TLD pricing from registrar APIs and writes data/pricing.json.
 *
 * Usage: PORKBUN_API_KEY=x PORKBUN_SECRET=x CLOUDFLARE_API_TOKEN=x CLOUDFLARE_ACCOUNT_ID=x node scripts/scrape-pricing.mjs
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "data", "pricing.json");

const NOW = new Date().toISOString();

async function scrapePorkbun() {
  const apiKey = process.env.PORKBUN_API_KEY;
  const secret = process.env.PORKBUN_SECRET;

  if (!apiKey || !secret) {
    console.warn("PORKBUN: skipping (no API key)");
    return null;
  }

  try {
    const res = await fetch("https://api.porkbun.com/api/json/v3/pricing/get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: apiKey, secretapikey: secret }),
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
        price_updated_at: NOW,
      };
    }

    console.log(`PORKBUN: scraped ${Object.keys(results).length} TLDs`);
    return results;
  } catch (err) {
    console.warn(`PORKBUN: error - ${err.message}`);
    return null;
  }
}

const TRACKED_TLDS = ["com", "io", "ai", "dev", "net", "org", "xyz", "app"];

function probeDomainsForTld(tld) {
  return [
    `agentdomain-probe-${tld}.${tld}`,
    `zzzdapriceprobe${tld}.${tld}`,
    `agentdomain-price-probe-${tld}.${tld}`,
  ];
}

async function scrapeCloudflare() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

  if (!token || !accountId) {
    console.warn("CLOUDFLARE: skipping (no API token or account ID)");
    return null;
  }

  const results = {};
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/registrar/domain-check`;

  for (const tld of TRACKED_TLDS) {
    let priced = false;

    for (const domain of probeDomainsForTld(tld)) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ domains: [domain] }),
        });

        if (!res.ok) {
          console.warn(`CLOUDFLARE: ${tld} API returned ${res.status}`);
          break;
        }

        const data = await res.json();
        const entry = data?.result?.domains?.[0];
        if (!entry?.registrable || !entry.pricing) {
          continue;
        }

        const reg = parseFloat(entry.pricing.registration_cost);
        const ren = parseFloat(entry.pricing.renewal_cost);
        if (Number.isNaN(reg) || Number.isNaN(ren)) {
          continue;
        }

        results[tld] = {
          registrar: "cloudflare",
          year1_usd_cents: Math.round(reg * 100),
          renewal_usd_cents: Math.round(ren * 100),
          transfer_usd_cents: Math.round(reg * 100),
          url: "https://www.cloudflare.com/products/registrar/",
          price_updated_at: NOW,
        };
        priced = true;
        break;
      } catch (err) {
        console.warn(`CLOUDFLARE: ${tld} error - ${err.message}`);
        break;
      }
    }

    if (!priced) {
      console.warn(`CLOUDFLARE: could not price TLD .${tld}`);
    }
  }

  console.log(`CLOUDFLARE: scraped ${Object.keys(results).length} TLDs`);
  return Object.keys(results).length > 0 ? results : null;
}

async function main() {
  console.log("Starting pricing scrape...\n");

  // Load existing data as fallback
  let existing = null;
  try {
    existing = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
  } catch {
    // No existing data
  }

  const porkbunData = await scrapePorkbun();
  const cloudflareData = await scrapeCloudflare();

  // Merge results
  const tlds = {};
  const registrars = new Set(existing?.registrars || []);

  // Start with existing data
  if (existing?.tlds) {
    for (const [tld, data] of Object.entries(existing.tlds)) {
      tlds[tld] = { prices: [...data.prices] };
    }
  }

  // Merge Porkbun data
  if (porkbunData) {
    registrars.add("porkbun");
    for (const [tld, price] of Object.entries(porkbunData)) {
      if (!tlds[tld]) tlds[tld] = { prices: [] };
      tlds[tld].prices = tlds[tld].prices.filter(
        (p) => p.registrar !== "porkbun"
      );
      tlds[tld].prices.push(price);
    }
  }

  // Merge Cloudflare data
  if (cloudflareData) {
    registrars.add("cloudflare");
    for (const [tld, price] of Object.entries(cloudflareData)) {
      if (!tlds[tld]) tlds[tld] = { prices: [] };
      tlds[tld].prices = tlds[tld].prices.filter(
        (p) => p.registrar !== "cloudflare"
      );
      tlds[tld].prices.push(price);
    }
  }

  // Sort prices within each TLD (cheapest first)
  for (const tld of Object.keys(tlds)) {
    tlds[tld].prices.sort((a, b) => a.year1_usd_cents - b.year1_usd_cents);
  }

  const output = {
    version: 1,
    updated_at: NOW,
    registrars: [...registrars].sort(),
    tlds,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nDone. Wrote ${Object.keys(tlds).length} TLDs to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
