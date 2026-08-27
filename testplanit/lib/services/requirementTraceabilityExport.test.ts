// Converted from the it.todo scaffold (26-02) by 26-08. This module must
// stay free of any runtime dependency on Prisma or any server-only
// module, mirroring lib/services/milestoneExport.ts's split (26-PATTERNS.md
// "Traceability matrix export").

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildRequirementPaths,
  buildTraceabilityRows,
  toGapRows,
  type RequirementNode,
  type RequirementTraceabilityRow,
} from "./requirementTraceabilityExport";

import type {
  RequirementCoverageBreakdown,
  RequirementCoverageStatus,
  RequirementCoveringCase,
} from "./requirementCoverage";

function node(
  overrides: Partial<RequirementNode> & { id: number; name: string }
): RequirementNode {
  return {
    title: null,
    externalUrl: null,
    parentId: null,
    ...overrides,
  };
}

function breakdown(
  overrides: Partial<RequirementCoverageBreakdown> = {}
): RequirementCoverageBreakdown {
  return {
    linkedCaseCount: 0,
    crossProjectCaseCount: 0,
    directCaseCount: 0,
    directCrossProjectCaseCount: 0,
    passed: 0,
    failed: 0,
    inProgress: 0,
    notRun: 0,
    statuses: [],
    untested: 0,
    uncovered: true,
    status: "UNCOVERED",
    ...overrides,
  };
}

function coveringCase(
  overrides: Partial<RequirementCoveringCase> & {
    caseId: number;
    caseName: string;
  }
): RequirementCoveringCase {
  return {
    projectId: 1,
    projectName: "Project One",
    lastStatusName: null,
    lastStatusColor: null,
    lastStatusIsSuccess: null,
    lastStatusIsFailure: null,
    lastExecutedAt: null,
    lastTestRunId: null,
    ...overrides,
  };
}

describe("requirementTraceabilityExport", () => {
  it("builds a hierarchy path from a requirement's ancestors", () => {
    const root = node({ id: 1, name: "ROOT" });
    const mid = node({ id: 2, name: "MID", parentId: 1 });
    const leaf = node({ id: 3, name: "LEAF", parentId: 2 });

    const paths = buildRequirementPaths([root, mid, leaf]);

    expect(paths.get(1)).toBe("ROOT");
    expect(paths.get(2)).toBe("ROOT > MID");
    expect(paths.get(3)).toBe("ROOT > MID > LEAF");
  });

  it("emits one row per requirement and covering case, ordered by path then case name", () => {
    const reqA = node({ id: 1, name: "A-REQ" });
    const reqB = node({ id: 2, name: "B-REQ" });

    const coverage = new Map<number, RequirementCoverageBreakdown>([
      [
        1,
        breakdown({
          linkedCaseCount: 3,
          passed: 3,
          uncovered: false,
          status: "PASSED",
        }),
      ],
      [
        2,
        breakdown({ linkedCaseCount: 0, uncovered: true, status: "UNCOVERED" }),
      ],
    ]);
    const coveringCases = new Map<number, RequirementCoveringCase[]>([
      [
        1,
        [
          coveringCase({ caseId: 30, caseName: "Case C" }),
          coveringCase({ caseId: 10, caseName: "Case A" }),
          coveringCase({ caseId: 20, caseName: "Case B" }),
        ],
      ],
    ]);

    const rows = buildTraceabilityRows({
      requirements: [reqA, reqB],
      coverage,
      coveringCases,
    });

    expect(rows).toHaveLength(4);
    // reqA's three covering-case rows come first (path "A-REQ" sorts
    // before "B-REQ"), sorted by case name within the requirement.
    expect(rows.slice(0, 3).map((r) => r.caseName)).toEqual([
      "Case A",
      "Case B",
      "Case C",
    ]);
    expect(rows.slice(0, 3).every((r) => r.requirementPath === "A-REQ")).toBe(
      true
    );
    // reqB's single null-case gap row comes last.
    expect(rows[3].requirementPath).toBe("B-REQ");
    expect(rows[3].caseId).toBeNull();
  });

  it("emits a null caseName row for an uncovered requirement", () => {
    const uncovered = node({ id: 5, name: "UNCOVERED-REQ" });
    const coverage = new Map<number, RequirementCoverageBreakdown>([
      [
        5,
        breakdown({ linkedCaseCount: 0, uncovered: true, status: "UNCOVERED" }),
      ],
    ]);

    const rows = buildTraceabilityRows({
      requirements: [uncovered],
      coverage,
      coveringCases: new Map(),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].caseId).toBeNull();
    expect(rows[0].caseName).toBeNull();
    expect(rows[0].requirementId).toBe(5);
    expect(rows[0].linkedCaseCount).toBe(0);
    expect(rows[0].coverageStatus).toBe<RequirementCoverageStatus>("UNCOVERED");
  });

  it("emits a null statusName for a covering case with no execution", () => {
    const covered = node({ id: 6, name: "COVERED-REQ" });
    const coverage = new Map<number, RequirementCoverageBreakdown>([
      [
        6,
        breakdown({
          linkedCaseCount: 1,
          notRun: 1,
          uncovered: false,
          status: "NOT_RUN",
        }),
      ],
    ]);
    const coveringCases = new Map<number, RequirementCoveringCase[]>([
      [6, [coveringCase({ caseId: 100, caseName: "Never Run Case" })]],
    ]);

    const rows = buildTraceabilityRows({
      requirements: [covered],
      coverage,
      coveringCases,
    });

    expect(rows).toHaveLength(1);
    // Distinct from the null-case gap row above: caseId is non-null here.
    expect(rows[0].caseId).toBe(100);
    expect(rows[0].statusName).toBeNull();
    expect(rows[0].executedAt).toBeNull();
  });

  it("derives the gap rows as exactly the null-case rows", () => {
    const rows: RequirementTraceabilityRow[] = [
      {
        requirementId: 1,
        requirementKey: "REQ-1",
        requirementTitle: null,
        requirementPath: "REQ-1",
        caseId: 10,
        caseName: "Case A",
        caseProjectId: 1,
        caseProjectName: "Project One",
        statusName: "Passed",
        statusColor: "#00ff00",
        executedAt: "2026-08-01T00:00:00.000Z",
        linkedCaseCount: 1,
        coverageStatus: "PASSED",
      },
      {
        requirementId: 2,
        requirementKey: "REQ-2",
        requirementTitle: null,
        requirementPath: "REQ-2",
        caseId: null,
        caseName: null,
        caseProjectId: null,
        caseProjectName: null,
        statusName: null,
        statusColor: null,
        executedAt: null,
        linkedCaseCount: 0,
        coverageStatus: "UNCOVERED",
      },
    ];

    const gapRows = toGapRows(rows);

    expect(gapRows).toHaveLength(1);
    expect(gapRows[0]).toEqual({
      requirementId: 2,
      requirementKey: "REQ-2",
      requirementTitle: null,
      requirementPath: "REQ-2",
      linkedCaseCount: 0,
    });
  });

  it("imports no server-only module", () => {
    const filePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "requirementTraceabilityExport.ts"
    );
    const source = readFileSync(filePath, "utf8");
    const stripped = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const importLines = (stripped.match(/^import[^;]+;/gm) ?? []).join("\n");

    const forbidden = [
      "prisma",
      "baseDb",
      "next/server",
      "@/lib/db",
      "~/lib/db",
      "lib/zenstack",
      "server/db",
      "next-intl",
      "kysely",
    ];
    const offenders = forbidden.filter((token) => importLines.includes(token));

    expect(offenders).toEqual([]);
  });
});
