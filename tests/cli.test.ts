import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist/cli.js");

function runCli(args: string[]) {
  return spawnSync("node", [cli, ...args], {
    encoding: "utf-8",
    cwd: root,
  });
}

describe("CLI", () => {
  beforeAll(() => {
    const build = spawnSync("npm", ["run", "build"], {
      encoding: "utf-8",
      cwd: root,
    });
    if (build.status !== 0) {
      throw new Error(`Build failed: ${build.stderr}`);
    }
  });

  it("requires check subcommand for domain queries", () => {
    const result = runCli(["example.com", "--json"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr || result.stdout).toMatch(/no command|unknown/i);
  });

  it("exits 2 for invalid domain format", () => {
    const result = runCli(["check", "nodot", "--json"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/domain must have at least one dot/i);
  });

  it("exits 2 when more than 10 domains", () => {
    const domains = Array.from({ length: 11 }, (_, i) => `test${i}.com`).join(
      ","
    );
    const result = runCli(["check", domains, "--json"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/maximum 10 domains/i);
  });

  it("returns JSON for a valid domain via check subcommand", () => {
    const result = runCli(["check", "example.com", "--json"]);
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.domain).toBe("example.com");
    expect(parsed).toHaveProperty("available");
  });

  it("returns batch shape with errors on partial validation failure", () => {
    const result = runCli(["check", "example.com,nodot", "--json"]);
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.errors).toEqual([
      { domain: "nodot", reason: "domain must have at least one dot" },
    ]);
  });
});
