#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";

import { createRawDbClient } from "~/lib/rawDbClient";
import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import { convertToTipTapJsonValue } from "~/workers/testmoImportWorker";

/**
 * reconstructTestmoTables.ts — recover Testmo step tables the importer flattened.
 *
 * Root cause (fixed in workers/testmoImportWorker.ts): the importer's
 * TIPTAP_EXTENSIONS previously had no Table/TableRow/TableCell/TableHeader
 * node types, so when ProseMirror's DOMParser hit Testmo's
 * <figure class="table"><table><tr><td>, it had no rule for those tags and
 * spliced each cell's text into the surrounding paragraph with NO separator
 * — e.g. "Opp_A$5000close date...". <ul>/<li> survived because StarterKit
 * does register list nodes. The corruption was silent: ProseMirror doesn't
 * throw, so the importer's own JSON-parse-failure fallback never caught it.
 *
 * This script:
 *   1. DETECTS affected steps by scanning TestmoImportStaging's
 *      repository_case_steps rows (the raw Testmo HTML kept from the import)
 *      for text1/text3 containing "<table", scoped to a COMPLETED import job.
 *   2. Matches each Testmo case_id to its live TestPlanIt case via
 *      className (which stores the Testmo id — see
 *      TestmoImportMapping is unused/empty; className is the real join key),
 *      restricted to source='MANUAL' to skip unrelated JUnit-sourced cases
 *      whose name happens to look numeric.
 *   3. Matches each Testmo step to its live Steps row by RELATIVE RANK
 *      (dense_rank of display_order vs. dense_rank of "order"), not raw
 *      order equality — ~1,257 cases have 0-indexed step order instead of
 *      the usual 1-indexed, which breaks a naive order-value join.
 *   4. RECONSTRUCTS only the specific field (step and/or expectedResult)
 *      that actually contained a table, by re-running the raw Testmo HTML
 *      through the importer's own (now Table-aware) convertToTipTapJsonValue
 *      — the same function scripts/syncTestmoCaseEdits.ts relies on for
 *      byte-identical output. The sibling field is left untouched.
 *   5. Updates Steps rows IN PLACE (never delete+recreate — TestRunStepResults
 *      references Steps.id ON DELETE CASCADE), bumps the case's
 *      currentVersion, and snapshots a version, all in one transaction per
 *      case — matching syncTestmoCaseEdits.ts's convention.
 *   6. Writes an undo trail of every previous value touched.
 *
 * Usage:
 *   tsx scripts/reconstructTestmoTables.ts                      # detect + dry run
 *   tsx scripts/reconstructTestmoTables.ts --case 24525          # one case, dry run
 *   tsx scripts/reconstructTestmoTables.ts --verify              # diff-only, no writes
 *   tsx scripts/reconstructTestmoTables.ts --apply               # write for real
 *   tsx scripts/reconstructTestmoTables.ts --apply --limit 10
 *   UNDO_PATH=/path/undo.json tsx scripts/reconstructTestmoTables.ts --apply
 */

type AffectedField = "step" | "expectedResult";

interface AffectedStep {
  testmoCaseId: string;
  tpiCaseId: number;
  projectId: number;
  caseName: string;
  stepId: number;
  order: number;
  fields: AffectedField[];
  actionHtml: string;
  expectedHtml: string | null;
}

interface SkippedCase {
  testmoCaseId: string;
  tpiCaseId: number;
  displayOrder: number;
  reason: string;
}

const HTML_ENTITIES: Record<string, string> = {
  "&gt;": ">",
  "&lt;": "<",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Strip tags/entities down to comparable plain text. */
function stripHtml(html: string): string {
  let text = html.replace(/<[^>]+>/g, " ");
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    text = text.replaceAll(entity, char);
  }
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Flatten a TipTap/ProseMirror doc's text nodes into plain text. */
function extractPlainText(node: unknown): string {
  if (typeof node === "string") {
    try {
      return extractPlainText(JSON.parse(node));
    } catch {
      return "";
    }
  }
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown };
  const parts: string[] = [];
  if (typeof n.text === "string") parts.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) parts.push(extractPlainText(child));
  }
  return parts.join(" ");
}

/** Jaccard similarity over word sets — robust to punctuation/HTML noise. */
function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.split(" ").filter((w) => w.length > 1));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 1));
  if (!wordsA.size || !wordsB.size) return wordsA.size === wordsB.size ? 1 : 0;
  let intersection = 0;
  for (const w of wordsA) if (wordsB.has(w)) intersection += 1;
  return intersection / (wordsA.size + wordsB.size - intersection);
}

/**
 * Safety gate against silent misalignment (e.g. a case where TestPlanIt is
 * missing steps Testmo has — rank N in Testmo then lines up with the WRONG
 * live step). Compares the untouched sibling field's plain text (the action
 * text when only expectedResult has a table, or vice versa) between the raw
 * Testmo HTML and the step currently stored, using the field that ISN'T
 * being rewritten as an independent check on whether the rank match is even
 * pointing at the same conceptual step.
 */
const CONTENT_MATCH_THRESHOLD = 0.4;

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

const APPLY = process.argv.includes("--apply");
const VERIFY = process.argv.includes("--verify");
const LIMIT = arg("--limit") ? Number(arg("--limit")) : undefined;
const ONLY_CASE = arg("--case") ? Number(arg("--case")) : undefined;
const JOB_ID = arg("--job");

const EMPTY_DOC = '{"type":"doc","content":[{"type":"paragraph"}]}';

/**
 * Render Testmo HTML the way the (fixed) importer does, as a JSON STRING —
 * matching syncTestmoCaseEdits.ts's toStepJson and how Steps.step/
 * expectedResult are actually stored (reading a live row back gives a
 * string, not a parsed object; writing a bare object here would leave this
 * row in a different shape than every other step).
 */
function toStepJson(html: string): string {
  const doc = convertToTipTapJsonValue(html);
  return doc === null ? EMPTY_DOC : JSON.stringify(doc);
}

async function findCompletedJobId(db: any): Promise<string> {
  const job = await db.testmoImportJob.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (!job) {
    throw new Error(
      "No COMPLETED TestmoImportJob found. Pass --job <jobId> explicitly."
    );
  }
  return job.id;
}

/** Detect every repository_case_steps row with a table in its raw HTML. */
async function detectAffectedSteps(
  db: any,
  jobId: string
): Promise<AffectedStep[]> {
  // Pass 1: cheap scan for which Testmo case_ids have >=1 step with a table
  // anywhere in it. Filtering here only narrows *which cases* to look at —
  // rank must still be computed from each case's COMPLETE step list (pass 2),
  // never from this pre-filtered subset, or a table step that isn't the
  // case's first step would rank against the wrong position.
  const affectedCaseIds: Array<{ caseId: string }> = await db.$queryRawUnsafe(
    `
    SELECT DISTINCT "rowData"->>'case_id' AS "caseId"
    FROM "TestmoImportStaging"
    WHERE "datasetName" = 'repository_case_steps'
      AND "jobId" = $1
      AND ("rowData"->>'text1' ILIKE '%<table%' OR "rowData"->>'text3' ILIKE '%<table%')
    `,
    jobId
  );
  let caseIds = affectedCaseIds.map((r) => r.caseId);
  if (ONLY_CASE !== undefined) {
    const c = await db.repositoryCases.findUnique({
      where: { id: ONLY_CASE },
      select: { className: true },
    });
    caseIds = c ? caseIds.filter((id) => id === c.className) : [];
  }
  if (!caseIds.length) return [];

  // Pass 2: every step row (table or not) for exactly those cases, so rank
  // reflects true position within the case's full step sequence.
  const rows: Array<{
    caseId: string;
    displayOrder: number;
    text1: string | null;
    text3: string | null;
  }> = await db.$queryRawUnsafe(
    `
    SELECT
      "rowData"->>'case_id' AS "caseId",
      ("rowData"->>'display_order')::int AS "displayOrder",
      "rowData"->>'text1' AS "text1",
      "rowData"->>'text3' AS "text3"
    FROM "TestmoImportStaging"
    WHERE "datasetName" = 'repository_case_steps'
      AND "jobId" = $1
      AND "rowData"->>'case_id' = ANY($2::text[])
    `,
    jobId,
    caseIds
  );

  const byCase = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byCase.get(r.caseId) ?? [];
    list.push(r);
    byCase.set(r.caseId, list);
  }

  const out: AffectedStep[] = [];
  for (const [testmoCaseId, caseRows] of byCase) {
    const cases = await db.repositoryCases.findMany({
      where: { className: testmoCaseId, source: "MANUAL", isDeleted: false },
      select: { id: true, projectId: true, name: true },
    });
    if (cases.length !== 1) {
      console.warn(
        `  skip testmo case ${testmoCaseId}: ${cases.length} matching live case(s) (expected 1)`
      );
      continue;
    }
    const c = cases[0];

    const steps = await db.steps.findMany({
      where: { testCaseId: c.id, isDeleted: false },
      orderBy: { order: "asc" },
      select: { id: true, order: true },
    });

    // Rank-based join over the case's COMPLETE step list: dense_rank of
    // display_order on the Testmo side lines up with dense_rank of "order"
    // on the TestPlanIt side. Handles the ~1,257 cases whose Steps.order
    // starts at 0 instead of the usual 1, without assuming either side's
    // numbering is contiguous or 1-indexed.
    const sortedTestmo = [...caseRows].sort(
      (a, b) => a.displayOrder - b.displayOrder
    );
    // Dedup exact duplicate rows (the staging table holds rows from more
    // than one worker attempt for some cases) before deriving rank, so a
    // repeated row doesn't shift everything after it by one.
    const seenKeys = new Set<string>();
    const dedupedTestmo = sortedTestmo.filter((r) => {
      const key = `${r.displayOrder}|${r.text1}|${r.text3}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    const testmoRankByOrder = new Map<number, number>();
    let rank = 0;
    let prevOrder: number | undefined;
    for (const r of dedupedTestmo) {
      if (r.displayOrder !== prevOrder) {
        rank += 1;
        prevOrder = r.displayOrder;
      }
      testmoRankByOrder.set(r.displayOrder, rank);
    }

    const distinctOrders = new Set(dedupedTestmo.map((r) => r.displayOrder))
      .size;
    if (steps.length !== distinctOrders) {
      console.warn(
        `  case ${c.id} (testmo ${testmoCaseId}): step count mismatch ` +
          `(live ${steps.length} vs testmo ${distinctOrders}) — matching by rank anyway`
      );
    }

    for (const r of dedupedTestmo) {
      const actionHasTable = !!r.text1 && /<table/i.test(r.text1);
      const expectedHasTable = !!r.text3 && /<table/i.test(r.text3);
      const fields: AffectedField[] = [];
      if (actionHasTable) fields.push("step");
      if (expectedHasTable) fields.push("expectedResult");
      if (!fields.length) continue;

      const wantRank = testmoRankByOrder.get(r.displayOrder)!;
      const step = steps[wantRank - 1];
      if (!step) {
        console.warn(
          `  skip testmo case ${testmoCaseId} display_order ${r.displayOrder}: no live step at rank ${wantRank}`
        );
        continue;
      }

      out.push({
        testmoCaseId,
        tpiCaseId: c.id,
        projectId: c.projectId,
        caseName: c.name,
        stepId: step.id,
        order: step.order,
        fields,
        actionHtml: r.text1 ?? "",
        expectedHtml: r.text3 ?? null,
      });
    }

    if (LIMIT !== undefined && out.length >= LIMIT) break;
  }

  return LIMIT !== undefined ? out.slice(0, LIMIT) : out;
}

function preview(v: unknown, n = 90): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function main() {
  const db = createRawDbClient();
  const jobId = JOB_ID ?? (await findCompletedJobId(db));
  console.log(
    `Using TestmoImportJob ${jobId} as the source of raw Testmo HTML.\n`
  );

  const affected = await detectAffectedSteps(db, jobId);
  const distinctCases = new Set(affected.map((a) => a.tpiCaseId)).size;
  console.log(
    `Detected ${affected.length} step field(s) with lost table formatting across ${distinctCases} case(s).\n`
  );

  const undo: unknown[] = [];
  const undoPath =
    process.env.UNDO_PATH ??
    `${process.env.HOME ?? "."}/reconstructTestmoTables.undo.json`;

  let applied = 0;
  let unchanged = 0;
  let failed = 0;
  let verifyOk = 0;
  let verifyMismatch = 0;
  const skipped: SkippedCase[] = [];

  const byCase = new Map<number, AffectedStep[]>();
  for (const a of affected) {
    const list = byCase.get(a.tpiCaseId) ?? [];
    list.push(a);
    byCase.set(a.tpiCaseId, list);
  }

  for (const [tpiCaseId, steps] of byCase) {
    const current = await db.steps.findMany({
      where: { id: { in: steps.map((s) => s.stepId) } },
      select: { id: true, step: true, expectedResult: true },
    });
    const currentById = new Map(current.map((c: any) => [c.id, c]));

    const updates: Array<{
      stepId: number;
      data: Record<string, unknown>;
      prior: Record<string, unknown>;
      changedFields: AffectedField[];
    }> = [];

    for (const s of steps) {
      const cur = currentById.get(s.stepId);
      if (!cur) continue;

      // Safety gate: an anchor field NOT being rewritten (action text when
      // only expectedResult has the table, or vice versa) must still
      // resemble what Testmo has at this rank, or the rank match is
      // pointing at the wrong step entirely (real drift — e.g. TestPlanIt
      // missing steps Testmo has — not just the usual 0- vs 1-indexing).
      const anchorField: AffectedField = s.fields.includes("step")
        ? "expectedResult"
        : "step";
      const anchorRawHtml =
        anchorField === "step" ? s.actionHtml : s.expectedHtml;
      if (anchorRawHtml !== null && anchorRawHtml !== "") {
        const rawText = stripHtml(anchorRawHtml);
        const liveText = extractPlainText(cur[anchorField]).toLowerCase();
        const score = wordOverlap(rawText, liveText);
        if (score < CONTENT_MATCH_THRESHOLD) {
          skipped.push({
            testmoCaseId: s.testmoCaseId,
            tpiCaseId: s.tpiCaseId,
            displayOrder: s.order,
            reason: `content mismatch on ${anchorField} (overlap ${score.toFixed(2)}) — likely step drift, needs manual review`,
          });
          continue;
        }
      }

      const data: Record<string, unknown> = {};
      const prior: Record<string, unknown> = {};
      const changedFields: AffectedField[] = [];

      for (const field of s.fields) {
        const html = field === "step" ? s.actionHtml : s.expectedHtml;
        if (html === null) continue;
        const next = toStepJson(html); // already a JSON string
        if (next === cur[field]) continue; // same shape as stored -> direct compare
        data[field] = next;
        prior[field] = cur[field];
        changedFields.push(field);
      }

      if (changedFields.length) {
        updates.push({ stepId: s.stepId, data, prior, changedFields });
      } else {
        unchanged += 1;
      }
    }

    if (!updates.length) continue;

    const caseInfo = steps[0];

    if (VERIFY) {
      for (const u of updates) {
        console.log(
          `  MISMATCH case ${tpiCaseId} step ${u.stepId} (order ${
            steps.find((s) => s.stepId === u.stepId)?.order
          }): ${u.changedFields.join(", ")}`
        );
        verifyMismatch += 1;
      }
      if (!updates.length) verifyOk += 1;
      continue;
    }

    if (!APPLY) {
      console.log(
        `[dry] case ${tpiCaseId} "${preview(caseInfo.caseName, 60)}" (testmo ${caseInfo.testmoCaseId}, project ${caseInfo.projectId}):`
      );
      for (const u of updates) {
        const step = steps.find((s) => s.stepId === u.stepId)!;
        console.log(
          `    step ${u.stepId} (order ${step.order}) -> ${u.changedFields.join(", ")}`
        );
        for (const f of u.changedFields) {
          console.log(`      before: ${preview(u.prior[f])}`);
          console.log(`      after : ${preview(u.data[f])}`);
        }
      }
      applied += 1;
      continue;
    }

    try {
      await db.$transaction(async (tx: any) => {
        const record: any = {
          caseId: tpiCaseId,
          testmoCaseId: caseInfo.testmoCaseId,
          steps: [],
        };
        for (const u of updates) {
          record.steps.push({ id: u.stepId, prior: u.prior });
          await tx.steps.update({ where: { id: u.stepId }, data: u.data });
        }
        await tx.repositoryCases.update({
          where: { id: tpiCaseId },
          data: { currentVersion: { increment: 1 } },
        });
        const version = await createTestCaseVersionInTransaction(
          tx,
          tpiCaseId,
          {}
        );
        record.versionId = version?.id ?? null;
        undo.push(record);
      });
      applied += 1;
      if (applied % 50 === 0) {
        writeFileSync(undoPath, JSON.stringify(undo, null, 1));
        console.log(`  …reconstructed ${applied} case(s)`);
      }
    } catch (e) {
      failed += 1;
      console.error(`  FAILED case ${tpiCaseId}:`, e);
    }
  }

  if (APPLY) writeFileSync(undoPath, JSON.stringify(undo, null, 1));

  if (skipped.length) {
    console.log(
      `\n${skipped.length} step(s) held back for manual review (content mismatch — likely step drift):`
    );
    for (const s of skipped) {
      console.log(
        `  case ${s.tpiCaseId} (testmo ${s.testmoCaseId}, display_order ${s.displayOrder}): ${s.reason}`
      );
    }
  }

  console.log(`\n${APPLY ? "applied" : VERIFY ? "verify" : "dry run"}`);
  console.log(`  step fields detected      : ${affected.length}`);
  console.log(`  distinct cases detected   : ${distinctCases}`);
  console.log(`  cases with real changes   : ${applied}`);
  console.log(`  already-correct steps     : ${unchanged}`);
  console.log(`  held back, needs review   : ${skipped.length}`);
  console.log(`  failed                    : ${failed}`);
  if (VERIFY) {
    console.log(`  verify: no diff           : ${verifyOk}`);
    console.log(`  verify: mismatched steps  : ${verifyMismatch}`);
  }
  if (APPLY) console.log(`  undo trail                : ${undoPath}`);
  if (!APPLY && !VERIFY)
    console.log("\nNothing was written. Re-run with --apply.");

  await db.$disconnect?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
