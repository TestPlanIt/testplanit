/**
 * Phase 14 Wave 0 — Nyquist verification scaffold (RED until the rollup map ships in 14-04).
 *
 * Pins COR-02: every audited child/join table attributes to its owning root entity
 * (RepositoryCases | TestRuns | Sessions) via the correct FK column, including the two-hop
 * cases and the join-table A/B-order landmine resolved against the live spike DB in 14-01.
 *
 * Gating: pure unit suite (plain `describe`) — runs in the no-DB unit lane. The not-yet-existing
 * `~/lib/audit/rollupMap` module is imported via a runtime-built specifier + /* @vite-ignore *​/
 * so Vite's static import-analysis can't resolve the missing module at transform time. That keeps
 * the suite RED (fails on the missing import inside the test) rather than failing to load.
 *
 * Implementing plan: 14-04 (lib/audit/rollupMap.ts).
 *
 * VERIFIED FK FACTS (14-01 live spike DB, information_schema + pg_constraint):
 *   - Issue join tables: column A → Issue FK, column B → ENTITY FK. The owning-entity FK is
 *     therefore column **B**, NOT column A (the RESEARCH.md draft assumed A — corrected here).
 *   - Tag join tables follow Prisma's alphabetical A/B rule: _RepositoryCasesToTags A=RepositoryCases,
 *     _SessionsToTags A=Sessions, _TagsToTestRuns A=Tags (so the TestRuns FK is column **B** there).
 *   - ResultFieldValues.testRunResultsId (PLURAL) vs TestRunStepResults.testRunResultId (SINGULAR).
 *   - TestCaseParameter.testCaseId confirmed (A1).
 */
import { describe, expect, it } from "vitest";

// Runtime-built specifier keeps Vite from statically resolving the not-yet-shipped module.
const rollupMapMod = "~/lib/audit/rollupMap";

// Minimal structural shape the assertions read — the real types ship in 14-04.
type RollupConfig = {
  ownerTable: string;
  fkCol: string;
  twoHop?: boolean;
  hopTable?: string;
  hopFkCol?: string;
};

const loadMap = async (): Promise<Record<string, RollupConfig>> => {
  const mod = (await import(/* @vite-ignore */ rollupMapMod)) as {
    ROLLUP_MAP: Record<string, RollupConfig>;
  };
  return mod.ROLLUP_MAP;
};

describe("rollupMap (COR-02) — child/join table → owning root entity attribution", () => {
  it("CaseFieldValues resolves owner RepositoryCases via fkCol testCaseId (direct)", async () => {
    const map = await loadMap();
    expect(map.CaseFieldValues).toMatchObject({
      ownerTable: "RepositoryCases",
      fkCol: "testCaseId",
    });
    expect(map.CaseFieldValues.twoHop).toBeFalsy();
  });

  it("project-config assignment tables roll up to Projects via projectId (direct)", async () => {
    const map = await loadMap();
    for (const t of [
      "ProjectWorkflowAssignment",
      "ProjectStatusAssignment",
      "MilestoneTypesAssignment",
      "ProjectAssignment",
    ]) {
      expect(map[t]).toMatchObject({
        ownerTable: "Projects",
        fkCol: "projectId",
      });
      expect(map[t].twoHop).toBeFalsy();
    }
  });

  it("Steps and TestCaseParameter both resolve RepositoryCases via testCaseId (A1 confirmed)", async () => {
    const map = await loadMap();
    expect(map.Steps).toMatchObject({
      ownerTable: "RepositoryCases",
      fkCol: "testCaseId",
    });
    expect(map.TestCaseParameter).toMatchObject({
      ownerTable: "RepositoryCases",
      fkCol: "testCaseId",
    });
  });

  it("TestRunStepResults is a two-hop entry (fkCol testRunResultId → TestRunResults.testRunId)", async () => {
    const map = await loadMap();
    expect(map.TestRunStepResults).toMatchObject({
      ownerTable: "TestRuns",
      fkCol: "testRunResultId", // SINGULAR
      twoHop: true,
      hopTable: "TestRunResults",
      hopFkCol: "testRunId",
    });
  });

  it("ResultFieldValues uses fkCol testRunResultsId (PLURAL landmine), two-hop to TestRuns", async () => {
    const map = await loadMap();
    expect(map.ResultFieldValues).toMatchObject({
      ownerTable: "TestRuns",
      fkCol: "testRunResultsId", // PLURAL — distinct from TestRunStepResults
      twoHop: true,
      hopTable: "TestRunResults",
      hopFkCol: "testRunId",
    });
  });

  it("Issue join tables attribute via column B (the ENTITY FK), NOT column A (the Issue FK)", async () => {
    const map = await loadMap();
    // Live spike DB: A → Issue, B → entity. Owning-entity FK is column B.
    expect(map._IssueToRepositoryCases).toMatchObject({
      ownerTable: "RepositoryCases",
      fkCol: "B",
    });
    expect(map._IssueToTestRuns).toMatchObject({
      ownerTable: "TestRuns",
      fkCol: "B",
    });
    expect(map._IssueToSessions).toMatchObject({
      ownerTable: "Sessions",
      fkCol: "B",
    });
    // Two-hop issue join tables also key off column B then resolve the hop.
    expect(map._IssueToTestRunResults).toMatchObject({
      ownerTable: "TestRuns",
      fkCol: "B",
      twoHop: true,
      hopTable: "TestRunResults",
      hopFkCol: "testRunId",
    });
    expect(map._IssueToTestRunStepResults).toMatchObject({
      ownerTable: "TestRuns",
      fkCol: "B",
    });
  });

  it("Tag join tables use the alphabetical A/B column that points at the OWNING entity", async () => {
    const map = await loadMap();
    // _RepositoryCasesToTags: A=RepositoryCases → fkCol A.
    expect(map._RepositoryCasesToTags).toMatchObject({
      ownerTable: "RepositoryCases",
      fkCol: "A",
    });
    // _SessionsToTags: A=Sessions → fkCol A.
    expect(map._SessionsToTags).toMatchObject({
      ownerTable: "Sessions",
      fkCol: "A",
    });
    // _TagsToTestRuns: A=Tags, B=TestRuns → the TestRuns FK is column B.
    expect(map._TagsToTestRuns).toMatchObject({
      ownerTable: "TestRuns",
      fkCol: "B",
    });
  });

  it("root entities RepositoryCases / TestRuns / Sessions are ABSENT (they attribute to themselves)", async () => {
    const map = await loadMap();
    expect(map.RepositoryCases).toBeUndefined();
    expect(map.TestRuns).toBeUndefined();
    expect(map.Sessions).toBeUndefined();
  });
});
