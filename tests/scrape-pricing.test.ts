import { describe, it, expect } from "vitest";
// @ts-expect-error - plain .mjs script, no type declarations
import { mergePricing, pricesEqual } from "../scripts/scrape-pricing.mjs";

const OLD = "2026-01-01T00:00:00.000Z";
const NOW = "2026-06-30T00:00:00.000Z";

function existingWith(price: Record<string, unknown>) {
  return {
    version: 1,
    updated_at: OLD,
    registrars: ["porkbun"],
    tlds: { com: { prices: [price] } },
  };
}

const PORKBUN_COM = {
  registrar: "porkbun",
  year1_usd_cents: 1025,
  renewal_usd_cents: 1125,
  transfer_usd_cents: 1025,
  url: "https://porkbun.com",
};

describe("pricesEqual", () => {
  it("ignores price_updated_at when comparing", () => {
    expect(
      pricesEqual(
        { ...PORKBUN_COM, price_updated_at: OLD },
        { ...PORKBUN_COM, price_updated_at: NOW }
      )
    ).toBe(true);
  });

  it("detects a changed price", () => {
    expect(
      pricesEqual(
        { ...PORKBUN_COM, price_updated_at: OLD },
        { ...PORKBUN_COM, year1_usd_cents: 999, price_updated_at: OLD }
      )
    ).toBe(false);
  });
});

describe("mergePricing", () => {
  it("preserves price_updated_at when the price is unchanged", () => {
    const existing = existingWith({ ...PORKBUN_COM, price_updated_at: OLD });
    const out = mergePricing(existing, { porkbun: { com: PORKBUN_COM } }, NOW);
    expect(out.tlds.com.prices[0].price_updated_at).toBe(OLD);
  });

  it("advances price_updated_at when the price changes", () => {
    const existing = existingWith({ ...PORKBUN_COM, price_updated_at: OLD });
    const changed = { ...PORKBUN_COM, year1_usd_cents: 999 };
    const out = mergePricing(existing, { porkbun: { com: changed } }, NOW);
    expect(out.tlds.com.prices[0].price_updated_at).toBe(NOW);
    expect(out.tlds.com.prices[0].year1_usd_cents).toBe(999);
  });

  it("stamps NOW on a brand-new registrar/TLD", () => {
    const out = mergePricing(null, { porkbun: { dev: PORKBUN_COM } }, NOW);
    expect(out.tlds.dev.prices[0].price_updated_at).toBe(NOW);
    expect(out.registrars).toContain("porkbun");
  });

  it("sets updated_at to the latest price_updated_at, not the run time", () => {
    const existing = {
      version: 1,
      updated_at: OLD,
      registrars: ["porkbun"],
      tlds: { com: { prices: [{ ...PORKBUN_COM, price_updated_at: OLD }] } },
    };
    // Nothing changed, so the only timestamp is OLD — updated_at must stay OLD.
    const out = mergePricing(existing, { porkbun: { com: PORKBUN_COM } }, NOW);
    expect(out.updated_at).toBe(OLD);
  });

  it("is byte-stable across runs when no price changed", () => {
    const existing = existingWith({ ...PORKBUN_COM, price_updated_at: OLD });
    const first = mergePricing(existing, { porkbun: { com: PORKBUN_COM } }, NOW);
    const second = mergePricing(
      first,
      { porkbun: { com: PORKBUN_COM } },
      "2026-12-31T00:00:00.000Z"
    );
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("skips a registrar whose scrape returned null", () => {
    const existing = existingWith({ ...PORKBUN_COM, price_updated_at: OLD });
    const out = mergePricing(
      existing,
      { porkbun: { com: PORKBUN_COM }, cloudflare: null },
      NOW
    );
    expect(out.tlds.com.prices).toHaveLength(1);
    expect(out.registrars).not.toContain("cloudflare");
  });
});
