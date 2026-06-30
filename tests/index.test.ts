import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkDomain, checkDomains } from "../src/index.js";

vi.mock("../src/availability/index.js", () => ({
  checkAvailability: vi.fn(),
}));

vi.mock("../src/pricing/index.js", () => ({
  getPricing: vi.fn(),
}));

describe("checkDomain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns full result for available domain", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    const { getPricing } = await import("../src/pricing/index.js");

    vi.mocked(checkAvailability).mockResolvedValue({ available: true, premium: false });
    vi.mocked(getPricing).mockResolvedValue({
      prices: [
        { registrar: "porkbun", year1_usd_cents: 1025, renewal_usd_cents: 1125, transfer_usd_cents: 1025, url: "https://porkbun.com", price_updated_at: "2026-06-30T00:00:00Z" },
      ],
      stale: false,
    });

    const result = await checkDomain("available-test.com");

    expect(result.domain).toBe("available-test.com");
    expect(result.available).toBe(true);
    expect(result.prices).toHaveLength(1);
    expect(result.cheapest?.registrar).toBe("porkbun");
    expect(result.tld_pricing).toBe(true);
  });

  it("sets pricing_stale when pricing cache is stale", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    const { getPricing } = await import("../src/pricing/index.js");

    vi.mocked(checkAvailability).mockResolvedValue({ available: true, premium: false });
    vi.mocked(getPricing).mockResolvedValue({
      prices: [
        {
          registrar: "porkbun",
          year1_usd_cents: 1025,
          renewal_usd_cents: 1125,
          transfer_usd_cents: 1025,
          url: null,
          price_updated_at: "2026-06-30T00:00:00Z",
        },
      ],
      stale: true,
    });

    const result = await checkDomain("stale-cache.com");
    expect(result.pricing_stale).toBe(true);
  });

  it("returns empty prices for taken domain", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    const { getPricing } = await import("../src/pricing/index.js");
    vi.mocked(checkAvailability).mockResolvedValue({ available: false, premium: false });

    const result = await checkDomain("google.com");

    expect(result.available).toBe(false);
    expect(result.prices).toEqual([]);
    expect(result.cheapest).toBeNull();
    expect(getPricing).not.toHaveBeenCalled();
  });

  it("throws on invalid domain (spaces)", async () => {
    await expect(checkDomain("has spaces.com")).rejects.toThrow("domain contains spaces");
  });

  it("throws on invalid domain (no dot)", async () => {
    await expect(checkDomain("nodot")).rejects.toThrow("domain must have at least one dot");
  });

  it("throws on invalid domain (empty)", async () => {
    await expect(checkDomain("")).rejects.toThrow("empty domain");
  });

  it("skips pricing when availability is unknown", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    const { getPricing } = await import("../src/pricing/index.js");
    vi.mocked(checkAvailability).mockResolvedValue({ available: null, premium: false });

    const result = await checkDomain("unknown.com");

    expect(result.available).toBeNull();
    expect(result.prices).toEqual([]);
    expect(getPricing).not.toHaveBeenCalled();
  });

  it("handles punycode (ASCII) domains", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    const { getPricing } = await import("../src/pricing/index.js");
    vi.mocked(checkAvailability).mockResolvedValue({ available: null, premium: false });

    const result = await checkDomain("test.xn--zckzah");
    expect(result.domain).toBe("test.xn--zckzah");
    expect(getPricing).not.toHaveBeenCalled();
  });

  it("normalizes domain to lowercase", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    const { getPricing } = await import("../src/pricing/index.js");
    vi.mocked(checkAvailability).mockResolvedValue({ available: null, premium: false });

    const result = await checkDomain("EXAMPLE.COM");
    expect(result.domain).toBe("example.com");
    expect(getPricing).not.toHaveBeenCalled();
  });
});

describe("checkDomains", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("throws when more than 10 domains", async () => {
    const domains = Array.from({ length: 11 }, (_, i) => `test${i}.com`);
    await expect(checkDomains(domains)).rejects.toThrow("Maximum 10 domains");
  });

  it("handles partial failures gracefully", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    vi.mocked(checkAvailability)
      .mockResolvedValueOnce({ available: true, premium: false })
      .mockRejectedValueOnce(new Error("network error"));

    const { getPricing } = await import("../src/pricing/index.js");
    vi.mocked(getPricing).mockResolvedValue({ prices: [], stale: false });

    const batch = await checkDomains(["good.com", "bad.com"]);

    expect(batch.results).toHaveLength(2);
    expect(batch.results[0].available).toBe(true);
    expect(batch.results[1].available).toBeNull();
    expect(batch.errors).toEqual([
      { domain: "bad.com", reason: "network error" },
    ]);
  });

  it("limits concurrent domain checks to 5", async () => {
    const { checkAvailability } = await import("../src/availability/index.js");
    const { getPricing } = await import("../src/pricing/index.js");

    let inFlight = 0;
    let maxInFlight = 0;

    vi.mocked(checkAvailability).mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return { available: null, premium: false };
    });

    const domains = Array.from({ length: 8 }, (_, i) => `test${i}.com`);
    await checkDomains(domains);

    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(getPricing).not.toHaveBeenCalled();
  });
});
