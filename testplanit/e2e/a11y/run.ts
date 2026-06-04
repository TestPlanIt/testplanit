/**
 * Orchestrates an a11y scan: runs the Playwright scan project, then the
 * aggregator, and propagates a non-zero exit when the scan or (in strict mode)
 * the aggregator fails — so CI gets a real signal.
 *
 *   pnpm a11y:scan                      # full scan, report mode
 *   pnpm a11y:scan -- --route=admin-users   # single route (setup still runs)
 *   A11Y_STRICT=on pnpm a11y:scan       # fail on serious/critical WCAG issues
 *
 * Spawns local binaries directly (not via `pnpm exec`) to avoid pnpm's
 * run-time dependency pruning, and defaults E2E_PROD=on (production build) and
 * the Elasticsearch node so search-driven views are populated.
 */
import { spawnSync } from "child_process";
import path from "path";

const cwd = path.resolve(__dirname, "..", ".."); // -> testplanit/
const bin = (name: string) => path.join(cwd, "node_modules", ".bin", name);

const routeArg = process.argv.find((a) => a.startsWith("--route="));
const route = routeArg ? routeArg.split("=")[1] : process.env.A11Y_ROUTE;

const env: NodeJS.ProcessEnv = { ...process.env };
env.E2E_PROD = env.E2E_PROD || "on";
env.ELASTICSEARCH_NODE = env.ELASTICSEARCH_NODE || "http://192.168.1.8:9221";
env.pnpm_config_verify_deps_before_run = "false";

const playwrightArgs = ["test", "--config", "e2e/a11y/playwright.config.ts"];
if (route) {
  // Keep the setup project's test in the selection so fixtures still seed.
  playwrightArgs.push("-g", `(seed a11y fixture data|${route})`);
  console.log(`[a11y] single-route run: ${route}`);
}

const scan = spawnSync(bin("playwright"), playwrightArgs, { cwd, env, stdio: "inherit" });
// Always aggregate, even if the scan reported failures (strict mode).
const agg = spawnSync(bin("tsx"), ["e2e/a11y/aggregate.ts"], { cwd, env, stdio: "inherit" });

process.exit((scan.status ?? 1) || (agg.status ?? 0));
