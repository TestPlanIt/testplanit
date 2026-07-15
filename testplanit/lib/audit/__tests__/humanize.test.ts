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
 * exercises the real rawDb lookup and copies the captureMatrix.test.ts RUN_DB_INTEGRATION gate
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
type LookupFn = (
  table: string,
  field: string,
  id: number | string
) => Promise<string | null>;
type HumanizeCache = {
  // resolve(table, field, id) returns the display name, hitting `lookup` only on a cache miss.
  resolve: (
    table: string,
    field: string,
    id: number | string
  ) => Promise<string | null>;
};
type HumanizeModule = {
  // createHumanizeCache(lookup, { ttlMs }) → an in-memory TTL cache that calls `lookup` on miss.
  createHumanizeCache: (
    lookup: LookupFn,
    opts: { ttlMs: number }
  ) => HumanizeCache;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  humanize: (
    cache: HumanizeCache,
    tableName: string,
    changedCols: any
  ) => Promise<any>;
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

  it("relabels an explicit m2m join (RepositoryCaseTag) to the named tag, dropping the caseId owner column", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const lookup = vi.fn<LookupFn>(async () => "regression");
    const cache = createHumanizeCache(lookup, { ttlMs: 60_000 });

    // caseId = RepositoryCases (owner, dropped); tagId = Tags (kept + named).
    const out = await humanize(cache, "RepositoryCaseTag", {
      caseId: { old: null, new: 4 },
      tagId: { old: null, new: 13 },
    });

    expect(out).toEqual({
      Tags: { old: null, new: 13, oldName: null, newName: "regression" },
    });
    expect(out.caseId).toBeUndefined();
    expect(out.tagId).toBeUndefined();
    expect(lookup).toHaveBeenCalledWith("Tags", "name", 13);
  });

  it("relabels an _IssueTo* join (owner column A → Issues) to the named issue", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const lookup = vi.fn<LookupFn>(async () => "Login is broken");
    const cache = createHumanizeCache(lookup, { ttlMs: 60_000 });

    // For _IssueTo* tables A = Issue (kept), B = owner (dropped).
    const out = await humanize(cache, "_IssueToTestRuns", {
      A: { old: null, new: 7 },
      B: { old: null, new: 99 },
    });

    expect(out).toEqual({
      Issues: { old: null, new: 7, oldName: null, newName: "Login is broken" },
    });
    expect(lookup).toHaveBeenCalledWith("Issue", "name", 7);
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

describe("humanize — root-table rich-text (TipTap) columns flatten to plain text", () => {
  const tiptapDoc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("flattens a Milestones.note change (object-encoded TipTap) to plain text", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const cache = createHumanizeCache(async () => null, { ttlMs: 60_000 });

    const out = await humanize(cache, "Milestones", {
      note: {
        old: tiptapDoc("Old description"),
        new: tiptapDoc("New description"),
      },
    });

    expect(out).toEqual({
      note: { old: "Old description", new: "New description" },
    });
  });

  it("flattens a string-encoded TipTap doc and both configured Milestones columns", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const cache = createHumanizeCache(async () => null, { ttlMs: 60_000 });

    const out = await humanize(cache, "Milestones", {
      docs: { old: null, new: JSON.stringify(tiptapDoc("Runbook link")) },
    });

    expect(out).toEqual({ docs: { old: null, new: "Runbook link" } });
  });

  it("keeps a null old side null and renders a present-but-empty doc as (empty)", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const cache = createHumanizeCache(async () => null, { ttlMs: 60_000 });

    const out = await humanize(cache, "Comment", {
      content: { old: null, new: { type: "doc", content: [] } },
    });

    expect(out).toEqual({ content: { old: null, new: "(empty)" } });
  });

  it("does not flatten a non-rich-text column on the same table (name passes through)", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const cache = createHumanizeCache(async () => null, { ttlMs: 60_000 });

    const out = await humanize(cache, "Milestones", {
      name: { old: "8.13", new: "8.14" },
      note: { old: tiptapDoc("a"), new: tiptapDoc("b") },
    });

    expect(out).toEqual({
      name: { old: "8.13", new: "8.14" },
      note: { old: "a", new: "b" },
    });
  });
});

describe("humanize — un-mapped Json columns never render as [object Object]", () => {
  const tiptapDoc = (text: string) => ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });

  it("flattens a TestRunResults.notes TipTap doc even though the table isn't in RICH_TEXT_COLUMNS", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const cache = createHumanizeCache(async () => null, { ttlMs: 60_000 });

    const out = await humanize(cache, "TestRunResults", {
      notes: { old: null, new: tiptapDoc("Repro steps") },
    });

    expect(out.notes).toEqual({ old: null, new: "Repro steps" });
  });

  it("renders an empty TipTap doc as (empty), not the raw doc JSON or [object Object]", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const cache = createHumanizeCache(async () => null, { ttlMs: 60_000 });

    const out = await humanize(cache, "TestRunResults", {
      notes: {
        old: null,
        new: { type: "doc", content: [{ type: "paragraph" }] },
      },
    });

    expect(out.notes.new).toBe("(empty)");
  });

  it("renders an empty evidence {} as (empty) and populated JSON as text, never [object Object]", async () => {
    const { createHumanizeCache, humanize } = await loadModule();
    const cache = createHumanizeCache(async () => null, { ttlMs: 60_000 });

    const out = await humanize(cache, "TestRunResults", {
      evidence: { old: null, new: {} },
    });
    expect(out.evidence.new).toBe("(empty)");

    const populated = await humanize(cache, "TestRunResults", {
      evidence: { old: null, new: { screenshots: 2 } },
    });
    expect(populated.evidence.new).toBe(JSON.stringify({ screenshots: 2 }));
    expect(String(populated.evidence.new)).not.toContain("[object Object]");
  });
});

describeDb("humanize (COR-03) — live rawDb catalog lookup", () => {
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
        [marker, marker, 1]
      );
      const fieldId = ins.rows[0].id as number;

      const humanizeModSpecifier = "~/lib/audit/humanize";
      const dbModSpecifier = "~/lib/rawDb";
      const { createHumanizeCache } = (await import(
        /* @vite-ignore */ humanizeModSpecifier
      )) as HumanizeModule;
      // lib/rawDb exports the base (extension-free) client as `rawDb`.
      const { rawDb: rawDb } = (await import(
        /* @vite-ignore */ dbModSpecifier
      )) as { rawDb: any };

      // The real lookup hits rawDb; assert it round-trips the seeded displayName.
      const lookup: LookupFn = async (table, field, id) => {
        const row = await rawDb.caseFields.findUnique({
          where: { id: Number(id) },
          select: { displayName: true },
        });
        return row?.displayName ?? null;
      };
      const cache = createHumanizeCache(lookup, { ttlMs: 60_000 });
      expect(await cache.resolve("CaseFields", "displayName", fieldId)).toBe(
        marker
      );

      await direct.query(`DELETE FROM "CaseFields" WHERE id = $1`, [fieldId]);
    } finally {
      await direct.end();
    }
  });
});
