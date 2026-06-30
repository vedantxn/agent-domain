import { defineCommand, runMain } from "citty";
import { checkDomain, checkDomains } from "./index.js";
import type { BatchCheckResult, DomainResult } from "./types.js";

function relativeTime(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const diffSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatTable(results: DomainResult[]): string {
  const lines: string[] = [];

  for (const r of results) {
    const status =
      r.available === true
        ? "✓ AVAILABLE"
        : r.available === false
          ? "✗ TAKEN"
          : "? UNKNOWN";

    lines.push(`${r.domain}  ${status}`);

    if (r.available && r.prices.length > 0) {
      lines.push("");
      lines.push("  Registrar       Year 1     Renewal");
      lines.push("  ─────────────────────────────────────");
      for (const p of r.prices) {
        const y1 = `$${(p.year1_usd_cents / 100).toFixed(2)}`;
        const ren = `$${(p.renewal_usd_cents / 100).toFixed(2)}`;
        const tag = p === r.cheapest ? " ← cheapest" : "";
        lines.push(
          `  ${p.registrar.padEnd(14)} ${y1.padEnd(10)} ${ren}${tag}`
        );
      }
      const lastChanged = r.prices
        .map((p) => p.price_updated_at)
        .filter((t) => !Number.isNaN(Date.parse(t)))
        .sort()
        .at(-1);
      const rel = lastChanged ? relativeTime(lastChanged) : null;
      if (rel) {
        lines.push("");
        lines.push(`  prices last changed: ${rel}`);
      }
    } else if (r.available && r.prices.length === 0) {
      lines.push("  (pricing data not available)");
    }
    lines.push("");
  }

  return lines.join("\n");
}

const checkCmd = defineCommand({
  meta: {
    description: "Check domain availability and registrar pricing",
  },
  args: {
    domains: {
      type: "positional",
      description: "Domain(s) to check",
      required: true,
    },
    json: {
      type: "boolean",
      description: "Output JSON (default for piped output)",
      default: false,
    },
    table: {
      type: "boolean",
      description: "Output human-readable table",
      default: false,
    },
  },
  async run({ args }) {
    const rawDomains = Array.isArray(args.domains)
      ? args.domains
      : [args.domains];
    const domains = rawDomains.flatMap((d: string) => d.split(/[,\s]+/)).filter(Boolean);

    if (domains.length === 0) {
      console.error("Error: provide at least one domain to check");
      process.exit(2);
    }

    if (domains.length > 10) {
      console.error("Error: maximum 10 domains per query");
      process.exit(2);
    }

    const useJson = args.json || (!args.table && !process.stdout.isTTY);

    try {
      let output: DomainResult | BatchCheckResult;
      let results: DomainResult[];

      if (domains.length === 1) {
        const result = await checkDomain(domains[0]);
        output = result;
        results = [result];
      } else {
        const batch = await checkDomains(domains);
        output = batch;
        results = batch.results;
      }

      const hasFailures = results.some((r) => r.available === null);

      if (useJson) {
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(formatTable(results));
      }

      if (hasFailures && results.some((r) => r.available !== null)) {
        process.exit(1);
      } else if (results.every((r) => r.available === null)) {
        process.exit(2);
      }
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Error: ${err.message}`);
      }
      process.exit(2);
    }
  },
});

const main = defineCommand({
  meta: {
    name: "agent-domain",
    version: "0.1.0",
    description:
      "Domain availability + cheapest registrar price. Zero config.",
  },
  subCommands: {
    check: checkCmd,
  },
});

export async function runCli(): Promise<void> {
  await runMain(main);
}
