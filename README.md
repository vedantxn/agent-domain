# agent-domain

Domain availability + cheapest registrar price for AI agents. Zero config.

```bash
npx agent-domain check example.com
```

```json
{
  "domain": "example.com",
  "available": false,
  "prices": [],
  "cheapest": null
}
```

```bash
npx agent-domain check mycoolstartup.dev
```

```json
{
  "domain": "mycoolstartup.dev",
  "available": true,
  "prices": [
    { "registrar": "porkbun", "year1_usd_cents": 999, "renewal_usd_cents": 1625 }
  ],
  "cheapest": { "registrar": "porkbun", "year1_usd_cents": 999 }
}
```

## Why

Every agent that helps users buy domains does the same dance: check WHOIS, then manually compare Namecheap vs Cloudflare vs Porkbun. This tool does it in one call.

- **Zero config** -- no API keys, no accounts, no setup
- **Agent-native** -- JSON output by default, MCP server included
- **Cross-registrar pricing** -- the only tool that compares prices

## Comparison

| Feature | agent-domain | tldx | domain-check |
|---------|:---:|:---:|:---:|
| Availability check | Yes | Yes | Yes |
| Price comparison | **Yes** | No | No |
| MCP server | Yes | Yes | No |
| Zero config | **Yes** | Yes | Yes |
| Cheapest registrar | **Yes** | No | No |

## Install

```bash
# Use directly (no install)
npx agent-domain check example.com

# Install globally
npm install -g agent-domain

# Use as library
npm install agent-domain
```

## CLI Usage

```bash
# Check a single domain
agent-domain check startup.ai

# Check multiple domains
agent-domain check startup.ai,startup.io,startup.dev

# Force JSON output
agent-domain check startup.ai --json

# Human-readable table
agent-domain check startup.ai --table
```

### Exit codes

- `0` -- all domains resolved successfully
- `1` -- partial failure (some domains failed)
- `2` -- total failure or invalid input

## Library Usage

```typescript
import { checkDomain, checkDomains, getPricing } from "agent-domain";

// Check a single domain
const result = await checkDomain("mycoolapp.dev");
console.log(result.available); // true
console.log(result.cheapest);  // { registrar: "porkbun", year1_usd_cents: 999, ... }

// Batch check (max 10)
const results = await checkDomains(["app1.com", "app2.io", "app3.dev"]);

// Get pricing for a TLD
const prices = await getPricing("com");
// [{ registrar: "spaceship", year1_usd_cents: 899, ... }, ...]
```

## MCP Server

Add to your Claude Code or Cursor config:

```json
{
  "mcpServers": {
    "agent-domain": {
      "command": "npx",
      "args": ["-y", "agent-domain", "--mcp"]
    }
  }
}
```

Tools available:
- `check_domain` -- check availability and pricing for one domain
- `check_domains` -- batch check up to 10 domains
- `get_pricing` -- get registrar pricing for a TLD

## How it works

1. **Pricing data** is verified hourly against Porkbun's public pricing API by the maintainer's CI and published as a static JSON file. Registrar list prices are per-TLD and change rarely, so each price carries a `price_updated_at` marking when it last actually changed (not when it was last fetched). Your CLI fetches this file and caches it locally for 1 hour. No API keys needed.

2. **Availability** is checked live via RDAP (the modern replacement for WHOIS). Free, standardized, no authentication required.

3. **DNS pre-check** is used as a speed optimization -- if NS records exist, the domain is almost certainly taken, so we skip the slower RDAP call.

## Pricing coverage

Currently tracking pricing across 8 TLDs from Porkbun (their full public price list). More registrars will be added as live scrapers are built for each:

| Registrar | Status |
|-----------|--------|
| Porkbun | Live (all TLDs they sell) |
| Cloudflare, Namecheap, GoDaddy, Spaceship | Planned |

Pricing is verified hourly. Since per-TLD list prices change rarely, `price_updated_at` reflects when a price last changed rather than the verification time.

## License

MIT
