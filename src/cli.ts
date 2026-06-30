#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { checkDomain, checkDomains } from "./index.js";
import type { DomainResult } from "./types.js";

if (process.argv.includes("--mcp")) {
  await import("./mcp.js");
} else {

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
      const results =
        domains.length === 1
          ? [await checkDomain(domains[0])]
          : await checkDomains(domains);

      const hasFailures = results.some((r) => r.available === null);

      if (useJson) {
        const output = domains.length === 1 ? results[0] : results;
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

runMain(main);

}
