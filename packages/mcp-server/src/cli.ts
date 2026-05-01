import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parseEnv, type EnvConfig } from "./env.js";
import {
  validateToken,
  redactToken,
  type ValidateResult,
  type WhoamiUser,
} from "./http.js";
import { createServer } from "./server.js";

export interface RunDeps {
  parseEnvImpl: (env: NodeJS.ProcessEnv) => EnvConfig;
  validateImpl: (env: EnvConfig) => Promise<ValidateResult>;
  createServerImpl: (deps: { env: EnvConfig; user: WhoamiUser }) => McpServer;
  connectImpl: (server: McpServer) => Promise<void>;
  errLog: (...args: unknown[]) => void;
  exitImpl: (code: number) => void;
}

/**
 * Default implementations wiring the real env, http, and stdio transport.
 * Overridden in tests to assert exit codes + serial order without spawning
 * a real subprocess.
 */
export const defaultRunDeps: RunDeps = {
  parseEnvImpl: parseEnv,
  validateImpl: validateToken,
  createServerImpl: createServer,
  connectImpl: async (server) => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  },
  errLog: (...args) => console.error(...args),
  exitImpl: (code) => process.exit(code),
};

/**
 * Bootstrap the MCP server in strict serial order:
 *   parseEnv → validateToken → createServer → connect (stdio)
 *
 * Bad env or bad token exits with code 1 BEFORE any transport connect.
 * All diagnostics go through `errLog` (defaults to `console.error`); raw
 * token values are NEVER logged — only the redacted `tpi_xxxx` prefix
 * appears in error messages (T-05-06).
 */
export async function runServer(deps: RunDeps = defaultRunDeps): Promise<void> {
  let env: EnvConfig;
  try {
    env = deps.parseEnvImpl(process.env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.errLog(`[testplanit-mcp] env error: ${message}`);
    deps.exitImpl(1);
    return;
  }

  const probe = await deps.validateImpl(env);
  if (!probe.ok) {
    deps.errLog(
      `[testplanit-mcp] token validation failed (${redactToken(env.apiToken)}): ${probe.message}`
    );
    deps.exitImpl(1);
    return;
  }

  const server = deps.createServerImpl({ env, user: probe.user });
  await deps.connectImpl(server);
  deps.errLog(`[testplanit-mcp] connected as ${probe.user.email}`);
}

// Top-level entry guard: only fires when this module is the npm bin entry.
// We resolve `process.argv[1]` through realpathSync because npm/npx install
// the bin as a symlink (e.g. `.bin/testplanit-mcp-server` → `dist/cli.js`),
// and node's `process.argv[1]` reports the shim path, not the symlink target.
// A naive `endsWith("cli.js")` check would silently exit 0 on `npx` invocation.
// Vitest imports `runServer` directly so its argv[1] is the vitest runner —
// the realpath check returns false there, so unit tests don't fire the bin.
function isInvokedAsBin(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.realpathSync(argv1).endsWith("cli.js");
  } catch {
    return false;
  }
}
if (isInvokedAsBin()) {
  runServer().catch((err) => {
    console.error("[testplanit-mcp] fatal:", err);
    process.exit(1);
  });
}
