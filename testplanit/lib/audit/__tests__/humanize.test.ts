/**
 * Phase 14 Wave 0 — Nyquist verification scaffold (RED until humanize ships in 14-04).
 *
 * Pins COR-03: FK values that appear in a DataChangeLog changedCols diff are resolved to a
 * human display name (CaseFields.displayName, ResultFields.displayName, Status.name,
 * Workflows.name) through a worker-local TTL cache — a second lookup inside the TTL window is
 * served from cache (no second DB call); after TTL expiry the cache refetches.
 *
 * Gating: the cache-behavior assertions are pure unit (plain `describe`) and inject a spy lookup
 * so no DB is needed to prove the cache hit/miss/refetch contract. The optional `describeDb` block
 * exercises the real prismaBase lookup and copies the captureMatrix.test.ts RUN_DB_INTEGRATION gate
 * verbatim, so it skips cleanly in the unit lane. The not-yet-existing `~/lib/audit/humanize`
 * module is imported via a runtime-built specifier + /* @vite-ignore *​/ so Vite cannot resolve it
 * at transform time (keeps the suite RED rather than failing to load).
 *
 * Implementing plan: 14-04 (lib/audit/humanize.ts).
 */
import { describe, expect, it, vi } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const DIRECT_URL = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const HAS_DB = Boolean(process.env.DATABASE_URL);
const describeDb = RUN_INTEGRATION && HAS_DB ? describe : describe.skip;

const humanizeMod = "~/lib/audit/humanize";

// Structural shape of the not-yet-shipped module the assertions read. Real types ship in 14-04.
type LookupFn = (table: string, field: string, id: number | string) => Promise<string | null>;
type HumanizeCache = {
  // resolve(table, field, id) returns the display name, hitting `lookup` only on a cache miss.
  resolve: (table: string, field: string, id: number | string) => Promise<string | null>;
};
type HumanizeModule = {
  // createHumanizeCache(lookup, { ttlMs }) → an in-memory TTL cache that calls `lookup` on miss.
  createHumanizeCache: (lookup: LookupFn, opts: { ttlMs: number }) => HumanizeCache;
};

const loadModule = async (): Promise<HumanizeModule> =>
  (await import(/* @vite-ignore */ humanizeMod)) as unknown as HumanizeModule;

describe("humanize (COR-03) — FK → display name with TTL cache", () => {
  it("resolves a fieldId in a diff to CaseFields.displayName on first lookup", async () => {
    const { createHumanizeCache } = await loadModule();
    const lookup = vi.fn<LookupFn>(async () => "Severity");
    const cache = createHumanizeCache(lookup, { ttlMs: 60_000 });

    const name = await cache.resolve("CaseFields", "displayName", 42);
    expect(name).toBe("Severity");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("CaseFields", "displayName", 42);
  });

  it("resolves a statusId to Status.name", async () => {
    const { createHumanizeCache } = await loadModule();
    const lookup = vi.fn<LookupFn>(async () => "In Progress");
    const cache = createHumanizeCache(lookup, { ttlMs: 60_000 });

    expect(await cache.resolve("Status", "name", 7)).toBe("In Progress");
  });

  it("serves a second lookup within the TTL window from cache (no second DB call)", async () => {
    const { createHumanizeCache } = await loadModule();
    const lookup = vi.fn<LookupFn>(async () => "Severity");
    const cache = createHumanizeCache(lookup, { ttlMs: 60_000 });

    await cache.resolve("CaseFields", "displayName", 42);
    await cache.resolve("CaseFields", "displayName", 42);

    // TTL window not elapsed → exactly one underlying lookup for the two resolves.
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL window expires", async () => {
    vi.useFakeTimers();
    try {
      const { createHumanizeCache } = await loadModule();
      const lookup = vi.fn<LookupFn>(async () => "Severity");
      const cache = createHumanizeCache(lookup, { ttlMs: 1_000 });

      await cache.resolve("CaseFields", "displayName", 42);
      vi.advanceTimersByTime(1_500); // past the 1s TTL
      await cache.resolve("CaseFields", "displayName", 42);

      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describeDb("humanize (COR-03) — live prismaBase catalog lookup", () => {
  it("resolves a seeded CaseFields.id to its displayName via the real lookup", async () => {
    const { Client } = await import("pg");
    const direct = new Client({ connectionString: DIRECT_URL });
    await direct.connect();
    try {
      // Seed a CaseFields row (drop outgoing FKs first so a minimal insert succeeds on the bare
      // spike DB — the disposable-spike-DB pattern from captureMatrix.test.ts).
      await direct.query(`DO $$
        DECLARE r record;
        BEGIN
          FOR r IN SELECT conname FROM pg_constraint
                    WHERE contype = 'f' AND conrelid = '"CaseFields"'::regclass
          LOOP EXECUTE format('ALTER TABLE "CaseFields" DROP CONSTRAINT IF EXISTS %I', r.conname); END LOOP;
        END $$;`);

      const marker = `hz-${Date.now()}`;
      // CaseFields requires the NOT-NULL systemName (unique) + typeId columns alongside
      // displayName; the FK drop above lets the bare typeId stand without a CaseFieldTypes parent.
      const ins = await direct.query(
        `INSERT INTO "CaseFields" ("displayName", "systemName", "typeId") VALUES ($1, $2, $3) RETURNING id`,
        [marker, marker, 1],
      );
      const fieldId = ins.rows[0].id as number;

      const humanizeModSpecifier = "~/lib/audit/humanize";
      const prismaModSpecifier = "~/lib/prismaBase";
      const { createHumanizeCache } = (await import(/* @vite-ignore */ humanizeModSpecifier)) as HumanizeModule;
      // lib/prismaBase exports the base (extension-free) client as `prisma`.
      const { prisma: prismaBase } = (await import(/* @vite-ignore */ prismaModSpecifier)) as { prisma: any };

      // The real lookup hits prismaBase; assert it round-trips the seeded displayName.
      const lookup: LookupFn = async (table, field, id) => {
        const row = await prismaBase.caseFields.findUnique({
          where: { id: Number(id) },
          select: { displayName: true },
        });
        return row?.displayName ?? null;
      };
      const cache = createHumanizeCache(lookup, { ttlMs: 60_000 });
      expect(await cache.resolve("CaseFields", "displayName", fieldId)).toBe(marker);

      await direct.query(`DELETE FROM "CaseFields" WHERE id = $1`, [fieldId]);
    } finally {
      await direct.end();
    }
  });
});
