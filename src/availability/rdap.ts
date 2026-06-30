const RDAP_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";

const PREMIUM_STATUS_MARKERS = ["premium", "reserved", "allocated"];

let bootstrapCache: Record<string, string> | null = null;

async function getBootstrap(): Promise<Record<string, string>> {
  if (bootstrapCache) return bootstrapCache;

  const res = await fetch(RDAP_BOOTSTRAP_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch RDAP bootstrap: ${res.status}`);
  }

  const data = (await res.json()) as {
    services: [string[], string[]][];
  };

  const map: Record<string, string> = {};
  for (const [tlds, urls] of data.services) {
    const serverUrl = urls[0];
    for (const tld of tlds) {
      map[tld] = serverUrl.replace(/\/$/, "");
    }
  }

  bootstrapCache = map;
  return map;
}

function extractTld(domain: string): string {
  const parts = domain.split(".");
  if (parts.length < 2) throw new Error(`Invalid domain: ${domain}`);
  return parts.slice(1).join(".");
}

function isPremiumStatus(statuses: string[]): boolean {
  return statuses.some((status) =>
    PREMIUM_STATUS_MARKERS.some((marker) =>
      status.toLowerCase().includes(marker)
    )
  );
}

export async function fetchRdapWithRetry(
  url: string,
  options: { signal?: AbortSignal; maxRetries?: number } = {}
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  let delayMs = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { signal: options.signal });

    if (res.status !== 429 || attempt === maxRetries) {
      return res;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs *= 2;
  }

  throw new Error("RDAP fetch failed after retries");
}

export async function checkRdap(
  domain: string
): Promise<{ available: boolean | null; premium: boolean }> {
  const tld = extractTld(domain);

  let serverUrl: string;
  try {
    const bootstrap = await getBootstrap();
    serverUrl = bootstrap[tld];
    if (!serverUrl) {
      return { available: null, premium: false };
    }
  } catch {
    return { available: null, premium: false };
  }

  const url = `${serverUrl}/domain/${domain}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetchRdapWithRetry(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 404) {
      return { available: true, premium: false };
    }

    if (!res.ok) {
      return { available: null, premium: false };
    }

    const data = (await res.json()) as {
      status?: string[];
      events?: { eventAction: string }[];
    };

    const statuses = data.status || [];
    const premium = isPremiumStatus(statuses);

    const isActive = statuses.some(
      (s) =>
        s === "active" ||
        s === "registered" ||
        s === "server renew prohibited" ||
        s === "client transfer prohibited"
    );

    if (isActive) {
      return { available: false, premium };
    }

    const isRedemption = statuses.some(
      (s) => s === "redemption period" || s === "pending delete"
    );
    if (isRedemption) {
      return { available: false, premium };
    }

    return { available: false, premium };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { available: null, premium: false };
    }
    return { available: null, premium: false };
  }
}

export function clearBootstrapCache(): void {
  bootstrapCache = null;
}
