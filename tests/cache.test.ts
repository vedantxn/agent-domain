import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  statSync: vi.fn(),
}));

const sampleData = {
  version: 1,
  updated_at: "2026-06-30T00:00:00Z",
  registrars: ["porkbun"],
  tlds: {
    com: {
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
    },
  },
};

describe("getPricingData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns fresh cache when TTL not expired", async () => {
    const { existsSync, statSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({ mtimeMs: Date.now() } as never);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleData));

    const { getPricingData } = await import("../src/pricing/cache.js");
    const result = await getPricingData();

    expect(result.data?.tlds.com).toBeDefined();
    expect(result.stale).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches from CDN when cache is stale", async () => {
    const { existsSync, statSync, readFileSync, writeFileSync } =
      await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: Date.now() - 2 * 60 * 60 * 1000,
    } as never);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleData));

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => sampleData,
    } as Response);

    const { getPricingData } = await import("../src/pricing/cache.js");
    const result = await getPricingData();

    expect(fetch).toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();
    expect(result.stale).toBe(false);
    expect(result.data?.version).toBe(1);
  });

  it("serves stale cache when CDN fetch fails", async () => {
    const { existsSync, statSync, readFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(statSync).mockReturnValue({
      mtimeMs: Date.now() - 2 * 60 * 60 * 1000,
    } as never);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(sampleData));

    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    const { getPricingData } = await import("../src/pricing/cache.js");
    const result = await getPricingData();

    expect(result.stale).toBe(true);
    expect(result.data?.tlds.com).toBeDefined();
  });

  it("returns null when no cache and CDN fails", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));

    const { getPricingData } = await import("../src/pricing/cache.js");
    const result = await getPricingData();

    expect(result.data).toBeNull();
    expect(result.stale).toBe(false);
  });

  it("returns fetched data when cache write fails", async () => {
    const { existsSync, writeFileSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(writeFileSync).mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => sampleData,
    } as Response);

    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const { getPricingData } = await import("../src/pricing/cache.js");
    const result = await getPricingData();

    expect(result.data?.version).toBe(1);
    expect(result.stale).toBe(false);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("failed to write pricing cache")
    );

    stderr.mockRestore();
  });
});
