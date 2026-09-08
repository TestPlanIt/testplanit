import { afterEach, describe, expect, it } from "vitest";

import {
  getPrimaryStickyMs,
  getReplicaUrls,
  isReplicaRoutingEnabled,
} from "./replicaConfig";

// These helpers read process.env on every call (no module-load caching), so a
// case just sets/clears the vars around the assertion.
describe("replicaConfig", () => {
  afterEach(() => {
    delete process.env.DATABASE_REPLICA_URLS;
    delete process.env.DATABASE_PRIMARY_STICKY_MS;
  });

  describe("getReplicaUrls", () => {
    it("returns [] when unset (feature dormant)", () => {
      delete process.env.DATABASE_REPLICA_URLS;
      expect(getReplicaUrls()).toEqual([]);
    });

    it("returns [] when empty string", () => {
      process.env.DATABASE_REPLICA_URLS = "";
      expect(getReplicaUrls()).toEqual([]);
    });

    it("parses a single url", () => {
      process.env.DATABASE_REPLICA_URLS = "postgres://ro-1/db";
      expect(getReplicaUrls()).toEqual(["postgres://ro-1/db"]);
    });

    it("splits comma-separated urls, trimming whitespace", () => {
      process.env.DATABASE_REPLICA_URLS =
        " postgres://ro-1/db , postgres://ro-2/db ";
      expect(getReplicaUrls()).toEqual([
        "postgres://ro-1/db",
        "postgres://ro-2/db",
      ]);
    });

    it("drops empty entries from trailing/duplicate commas", () => {
      process.env.DATABASE_REPLICA_URLS =
        "postgres://ro-1/db,,postgres://ro-2/db,";
      expect(getReplicaUrls()).toEqual([
        "postgres://ro-1/db",
        "postgres://ro-2/db",
      ]);
    });
  });

  describe("isReplicaRoutingEnabled", () => {
    it("is false when unset", () => {
      delete process.env.DATABASE_REPLICA_URLS;
      expect(isReplicaRoutingEnabled()).toBe(false);
    });

    it("is false when only whitespace/commas", () => {
      process.env.DATABASE_REPLICA_URLS = " , , ";
      expect(isReplicaRoutingEnabled()).toBe(false);
    });

    it("is true when at least one url is configured", () => {
      process.env.DATABASE_REPLICA_URLS = "postgres://ro-1/db";
      expect(isReplicaRoutingEnabled()).toBe(true);
    });
  });

  describe("getPrimaryStickyMs", () => {
    it("defaults to 5000 when unset", () => {
      delete process.env.DATABASE_PRIMARY_STICKY_MS;
      expect(getPrimaryStickyMs()).toBe(5000);
    });

    it("defaults to 5000 when empty", () => {
      process.env.DATABASE_PRIMARY_STICKY_MS = "";
      expect(getPrimaryStickyMs()).toBe(5000);
    });

    it("honors 0 (disables the cookie tier)", () => {
      process.env.DATABASE_PRIMARY_STICKY_MS = "0";
      expect(getPrimaryStickyMs()).toBe(0);
    });

    it("parses a positive integer", () => {
      process.env.DATABASE_PRIMARY_STICKY_MS = "8000";
      expect(getPrimaryStickyMs()).toBe(8000);
    });

    it("floors fractional values", () => {
      process.env.DATABASE_PRIMARY_STICKY_MS = "1500.9";
      expect(getPrimaryStickyMs()).toBe(1500);
    });

    it("falls back to default on non-numeric or negative input", () => {
      process.env.DATABASE_PRIMARY_STICKY_MS = "abc";
      expect(getPrimaryStickyMs()).toBe(5000);
      process.env.DATABASE_PRIMARY_STICKY_MS = "-100";
      expect(getPrimaryStickyMs()).toBe(5000);
    });
  });
});
