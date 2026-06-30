import { checkAvailability } from "./availability/index.js";
import { getPricing } from "./pricing/index.js";
import type { BatchCheckResult, DomainResult } from "./types.js";

export type {
  DomainResult,
  RegistrarPrice,
  PricingData,
  TldPricing,
  BatchCheckResult,
} from "./types.js";

const MAX_CONCURRENT_CHECKS = 5;

function extractTld(domain: string): string {
  const parts = domain.split(".");
  if (parts.length < 2) throw new Error(`Invalid domain: ${domain}`);
  return parts.slice(1).join(".");
}

function validateDomain(domain: string): string | null {
  const cleaned = domain.trim().toLowerCase();
  if (!cleaned) return "empty domain";
  if (cleaned.includes(" ")) return "domain contains spaces";
  const parts = cleaned.split(".");
  if (parts.length < 2) return "domain must have at least one dot";
  if (parts.some((p) => p.length === 0)) return "domain has empty label";
  if (!/^[a-z0-9.-]+$/.test(cleaned))
    return "domain contains invalid characters (ASCII only)";
  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      try {
        const value = await fn(items[i]);
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export async function checkDomain(domain: string): Promise<DomainResult> {
  const error = validateDomain(domain);
  if (error) throw new Error(error);

  const normalized = domain.trim().toLowerCase();
  const tld = extractTld(normalized);

  const { available, premium } = await checkAvailability(normalized);
  const { prices, stale } =
    available === true ? await getPricing(tld) : { prices: [], stale: false };
  const cheapest = prices.length > 0 ? prices[0] : null;

  return {
    domain: normalized,
    available,
    premium,
    checked_at: new Date().toISOString(),
    prices,
    cheapest,
    tld_pricing: true,
    ...(stale ? { pricing_stale: true } : {}),
  };
}

export async function checkDomains(
  domains: string[]
): Promise<BatchCheckResult> {
  if (domains.length > 10) {
    throw new Error("Maximum 10 domains per batch query");
  }

  const settled = await mapWithConcurrency(
    domains,
    MAX_CONCURRENT_CHECKS,
    (d) => checkDomain(d)
  );

  const results: DomainResult[] = [];
  const errors: { domain: string; reason: string }[] = [];

  settled.forEach((r, i) => {
    const domain = domains[i].trim().toLowerCase();
    if (r.status === "fulfilled") {
      results.push(r.value);
    } else {
      const reason =
        r.reason instanceof Error ? r.reason.message : "Unknown error";
      errors.push({ domain, reason });
      results.push({
        domain,
        available: null,
        premium: false,
        checked_at: new Date().toISOString(),
        prices: [],
        cheapest: null,
        tld_pricing: true,
      });
    }
  });

  return {
    results,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

export { getPricing } from "./pricing/index.js";
export { checkAvailability } from "./availability/index.js";
