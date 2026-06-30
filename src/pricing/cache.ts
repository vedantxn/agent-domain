import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { PricingData } from "../types.js";

const PRICING_CDN_URL =
  "https://raw.githubusercontent.com/vedantnn/agent-domain/main/data/pricing.json";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg || join(homedir(), ".cache");
  return join(base, "agent-domain");
}

function getCachePath(): string {
  return join(getCacheDir(), "pricing.json");
}

function isCacheFresh(): boolean {
  const path = getCachePath();
  if (!existsSync(path)) return false;
  try {
    const stat = statSync(path);
    return Date.now() - stat.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

function readCache(): PricingData | null {
  const path = getCachePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as PricingData;
  } catch {
    return null;
  }
}

export function writeCache(data: PricingData): boolean {
  try {
    const dir = getCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(getCachePath(), JSON.stringify(data));
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`Warning: failed to write pricing cache: ${message}`);
    return false;
  }
}

async function fetchFromCdn(): Promise<PricingData | null> {
  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    res = await fetch(PRICING_CDN_URL, { signal: controller.signal });
    clearTimeout(timeout);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`Warning: failed to fetch pricing from CDN: ${message}`);
    return null;
  }

  if (!res.ok) {
    console.error(`Warning: pricing CDN returned HTTP ${res.status}`);
    return null;
  }

  let data: PricingData;
  try {
    data = (await res.json()) as PricingData;
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`Warning: failed to parse pricing CDN response: ${message}`);
    return null;
  }

  writeCache(data);
  return data;
}

export async function getPricingData(): Promise<{
  data: PricingData | null;
  stale: boolean;
}> {
  if (isCacheFresh()) {
    const data = readCache();
    if (data) return { data, stale: false };
  }

  const fresh = await fetchFromCdn();
  if (fresh) return { data: fresh, stale: false };

  const staleData = readCache();
  if (staleData) return { data: staleData, stale: true };

  return { data: null, stale: false };
}
