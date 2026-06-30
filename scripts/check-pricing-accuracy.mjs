#!/usr/bin/env node

/**
 * Compare committed pricing.json against live Porkbun API for sample TLDs.
 * Skips gracefully when API keys are not configured.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRICING_PATH = join(__dirname, "..", "data", "pricing.json");
const SAMPLE_TLDS = ["com", "io", "dev"];
const DRIFT_THRESHOLD = 0.5;

async function fetchPorkbunPricing() {
  const apiKey = process.env.PORKBUN_API_KEY;
  const secret = process.env.PORKBUN_SECRET;

  if (!apiKey || !secret) {
    console.warn("Skipping accuracy check: PORKBUN_API_KEY or PORKBUN_SECRET not set");
    process.exit(0);
  }

  const res = await fetch("https://api.porkbun.com/api/json/v3/pricing/get", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: apiKey, secretapikey: secret }),
  });

  if (!res.ok) {
    console.error(`Porkbun API returned ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  if (data.status !== "SUCCESS" || !data.pricing) {
    console.error("Unexpected Porkbun API response");
    process.exit(1);
  }

  return data.pricing;
}

function getCommittedPrice(pricingData, tld) {
  const entry = pricingData.tlds[tld]?.prices?.find(
    (p) => p.registrar === "porkbun"
  );
  return entry?.year1_usd_cents ?? null;
}

async function main() {
  const committed = JSON.parse(readFileSync(PRICING_PATH, "utf-8"));
  const tldCount = Object.keys(committed.tlds || {}).length;

  if (tldCount === 0) {
    console.error("pricing.json has 0 TLDs");
    process.exit(1);
  }

  const live = await fetchPorkbunPricing();
  if (!live || Object.keys(live).length === 0) {
    console.error("Live Porkbun scrape returned 0 TLDs");
    process.exit(1);
  }

  let failures = 0;

  for (const tld of SAMPLE_TLDS) {
    const committedCents = getCommittedPrice(committed, tld);
    const liveDollars = live[tld]?.registration;

    if (committedCents === null || !liveDollars) {
      console.warn(`Skipping .${tld}: missing committed or live price`);
      continue;
    }

    const liveCents = Math.round(parseFloat(liveDollars) * 100);
    const drift =
      Math.abs(liveCents - committedCents) / Math.max(committedCents, 1);

    console.log(
      `.${tld}: committed=${committedCents}c live=${liveCents}c drift=${(drift * 100).toFixed(1)}%`
    );

    if (drift > DRIFT_THRESHOLD) {
      console.error(
        `.${tld} drift ${(drift * 100).toFixed(1)}% exceeds ${DRIFT_THRESHOLD * 100}% threshold`
      );
      failures++;
    }
  }

  if (failures > 0) {
    process.exit(1);
  }

  console.log("Price accuracy check passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
