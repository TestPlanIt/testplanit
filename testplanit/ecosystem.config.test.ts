import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const configPath = require.resolve("./ecosystem.config.js");

const MEMORY_ENV = /_(MAX_MEMORY_RESTART|MAX_OLD_SPACE_MB)$/;

/** Each worker's restart ceiling and heap under the given env. */
function limits(env: Record<string, string> = {}) {
  for (const [name, value] of Object.entries(env)) process.env[name] = value;
  delete require.cache[configPath];
  const { apps } = require(configPath) as {
    apps: { name: string; max_memory_restart: string; node_args: string }[];
  };
  return (name: string) => {
    const app = apps.find((candidate) => candidate.name === name);
    if (!app) throw new Error(`No worker named ${name}`);
    return [
      app.max_memory_restart,
      Number(app.node_args.replace("--max-old-space-size=", "")),
    ];
  };
}

describe("ecosystem.config worker memory limits", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const name of Object.keys(process.env)) {
      if (MEMORY_ENV.test(name)) delete process.env[name];
    }
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const name of Object.keys(process.env)) {
      if (MEMORY_ENV.test(name)) delete process.env[name];
    }
    vi.restoreAllMocks();
  });

  it("keeps each tier's default with no overrides", () => {
    const worker = limits();

    expect(worker("email-worker")).toEqual(["512M", 384]);
    expect(worker("repo-cache-worker")).toEqual(["512M", 384]);
    expect(worker("forecast-worker")).toEqual(["2G", 1536]);
    expect(worker("testmo-import-worker")).toEqual(["4G", 3072]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("raises only the 512M tier through WORKER_MAX_MEMORY_RESTART", () => {
    const worker = limits({ WORKER_MAX_MEMORY_RESTART: "1G" });

    expect(worker("email-worker")).toEqual(["1G", 768]);
    expect(worker("repo-cache-worker")).toEqual(["1G", 768]);
    expect(worker("forecast-worker")).toEqual(["2G", 1536]);
  });

  it("prefers a worker's own ceiling and ignores the shared heap beside it", () => {
    const worker = limits({
      REPO_CACHE_MAX_MEMORY_RESTART: "2G",
      WORKER_MAX_MEMORY_RESTART: "1G",
      WORKER_MAX_OLD_SPACE_MB: "700",
    });

    expect(worker("repo-cache-worker")).toEqual(["2G", 1536]);
    expect(worker("email-worker")).toEqual(["1G", 700]);
  });

  it("hands PM2 a size it accepts for lowercase, decimal and B-suffixed values", () => {
    expect(limits({ WORKER_MAX_MEMORY_RESTART: "1g" })("email-worker")).toEqual(
      ["1024M", 768]
    );
    expect(
      limits({ WORKER_MAX_MEMORY_RESTART: "1.5G" })("email-worker")
    ).toEqual(["1536M", 1152]);
    expect(
      limits({ WORKER_MAX_MEMORY_RESTART: "2GB" })("email-worker")
    ).toEqual(["2048M", 1536]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls through an unreadable ceiling to the next level, warning once", () => {
    const worker = limits({
      REPO_CACHE_MAX_MEMORY_RESTART: "bogus",
      WORKER_MAX_MEMORY_RESTART: "1G",
    });
    expect(worker("repo-cache-worker")).toEqual(["1G", 768]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a ceiling too small to run a worker, warning once", () => {
    expect(
      limits({ WORKER_MAX_MEMORY_RESTART: "1024" })("email-worker")
    ).toEqual(["512M", 384]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores a heap that does not fit under the ceiling, warning once", () => {
    const worker = limits({ WORKER_MAX_OLD_SPACE_MB: "768" });

    expect(worker("email-worker")).toEqual(["512M", 384]);
    expect(worker("repo-cache-worker")).toEqual(["512M", 384]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
