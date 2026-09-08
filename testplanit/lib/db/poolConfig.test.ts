import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getPoolConfig,
  getPoolConnectionTimeoutMs,
  getPoolIdleTimeoutMs,
  getPoolMax,
  getStatementTimeoutMs,
} from "./poolConfig";

const ENV_KEYS = [
  "DATABASE_POOL_MAX",
  "DATABASE_POOL_CONNECTION_TIMEOUT_MS",
  "DATABASE_POOL_IDLE_TIMEOUT_MS",
  "DATABASE_STATEMENT_TIMEOUT_MS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("getPoolMax", () => {
  it("defaults to 20 rather than node-postgres' 10", () => {
    expect(getPoolMax()).toBe(20);
  });

  it("reads an explicit override", () => {
    process.env.DATABASE_POOL_MAX = "50";
    expect(getPoolMax()).toBe(50);
  });

  it.each(["", "   ", "abc", "-5", "0"])(
    "falls back to the default for %o",
    (raw) => {
      process.env.DATABASE_POOL_MAX = raw;
      expect(getPoolMax()).toBe(20);
    }
  );
});

describe("getPoolConnectionTimeoutMs", () => {
  // The whole point of the module: pg's default of 0 means "queue forever",
  // which is what let a slow-query burst hang every route in the app.
  it("defaults to a finite 10s wait, not pg's unbounded 0", () => {
    expect(getPoolConnectionTimeoutMs()).toBe(10_000);
  });

  it("honours an explicit 0 as opt-in unbounded waiting", () => {
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = "0";
    expect(getPoolConnectionTimeoutMs()).toBe(0);
  });

  it("rejects negative and non-numeric values", () => {
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = "-1";
    expect(getPoolConnectionTimeoutMs()).toBe(10_000);
    process.env.DATABASE_POOL_CONNECTION_TIMEOUT_MS = "soon";
    expect(getPoolConnectionTimeoutMs()).toBe(10_000);
  });
});

describe("getPoolIdleTimeoutMs", () => {
  it("defaults to 10s and allows 0 to disable eviction", () => {
    expect(getPoolIdleTimeoutMs()).toBe(10_000);
    process.env.DATABASE_POOL_IDLE_TIMEOUT_MS = "0";
    expect(getPoolIdleTimeoutMs()).toBe(0);
  });
});

describe("getStatementTimeoutMs", () => {
  // Opt-in on purpose: workers run multi-minute statements (bulk import,
  // magic-select, milestone sync, ES reindex) that a default would abort.
  it("is undefined unless explicitly configured", () => {
    expect(getStatementTimeoutMs()).toBeUndefined();
  });

  it("reads a positive override", () => {
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = "30000";
    expect(getStatementTimeoutMs()).toBe(30_000);
  });

  it.each(["0", "-1", "nope", "  "])("ignores %o", (raw) => {
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = raw;
    expect(getStatementTimeoutMs()).toBeUndefined();
  });
});

describe("getPoolConfig", () => {
  it("bounds the pool and the wait for a slot by default", () => {
    expect(getPoolConfig()).toEqual({
      max: 20,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 10_000,
    });
  });

  it("omits statement_timeout entirely when unset", () => {
    expect(getPoolConfig()).not.toHaveProperty("statement_timeout");
  });

  it("includes statement_timeout only when configured", () => {
    process.env.DATABASE_STATEMENT_TIMEOUT_MS = "30000";
    expect(getPoolConfig()).toMatchObject({ statement_timeout: 30_000 });
  });
});
