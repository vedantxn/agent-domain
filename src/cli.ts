#!/usr/bin/env node

export {};

if (process.argv.includes("--mcp")) {
  await import("./mcp.js");
} else {
  const { runCli } = await import("./cli-app.js");
  await runCli();
}
