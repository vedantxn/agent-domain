import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchRdapWithRetry,
  checkRdap,
  clearBootstrapCache,
} from "../src/availability/rdap.js";

const bootstrapPayload = {
  services: [[["com"], ["https://rdap.example.com/"]]],
};

describe("fetchRdapWithRetry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries on 429 then returns success", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ status: 429 } as Response)
      .mockResolvedValueOnce({ status: 200 } as Response);

    const res = await fetchRdapWithRetry("https://rdap.example.com/domain/test.com");
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns 429 after max retries exhausted", async () => {
    vi.mocked(fetch).mockResolvedValue({ status: 429 } as Response);

    const res = await fetchRdapWithRetry("https://rdap.example.com/domain/test.com", {
      maxRetries: 2,
    });
    expect(res.status).toBe(429);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("checkRdap", () => {
  beforeEach(() => {
    clearBootstrapCache();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearBootstrapCache();
  });

  it("returns available true on 404", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => bootstrapPayload,
      } as Response)
      .mockResolvedValueOnce({ status: 404 } as Response);

    const result = await checkRdap("available-name.com");
    expect(result).toEqual({ available: true, premium: false });
  });

  it("returns taken with premium flag when status indicates premium", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => bootstrapPayload,
      } as Response)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ status: ["active", "premium"] }),
      } as Response);

    const result = await checkRdap("premium.com");
    expect(result.available).toBe(false);
    expect(result.premium).toBe(true);
  });

  it("returns null availability when TLD not in bootstrap", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ services: [] }),
    } as Response);

    const result = await checkRdap("test.unknowntld");
    expect(result).toEqual({ available: null, premium: false });
  });
});
