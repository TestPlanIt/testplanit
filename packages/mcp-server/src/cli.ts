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
      `[testplanit-mcp] token validation failed (${redactToken(env.apiToken)}): ${probe.message}`,
    );
    deps.exitImpl(1);
    return;
  }

  const server = deps.createServerImpl({ env, user: probe.user });
  await deps.connectImpl(server);
  deps.errLog(`[testplanit-mcp] connected as ${probe.user.email}`);
}

// Top-level entry guard: only fires when this module is the npm bin entry.
// We check `process.argv[1]` (the script that node was invoked with) rather
// than `import.meta.url` or `require.main` so the same source compiles into
// both the ESM source path (vitest) and the CJS bundled output (tsup) without
// firing during unit tests, which import `runServer` directly.
const invokedAsBin = process.argv[1]?.endsWith("cli.js") ?? false;
if (invokedAsBin) {
  runServer().catch((err) => {
    console.error("[testplanit-mcp] fatal:", err);
    process.exit(1);
  });
}
