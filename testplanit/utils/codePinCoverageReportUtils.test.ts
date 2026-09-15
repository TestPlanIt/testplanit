import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, mockAuthorize } = vi.hoisted(() => ({
  db: {
    projectCodeRepositoryConfig: { findMany: vi.fn() },
    repositoryCaseCodePin: { findMany: vi.fn() },
    impactAnalysis: { findMany: vi.fn() },
    repositoryCases: { count: vi.fn() },
  },
  mockAuthorize: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ baseDb: db }));
vi.mock("~/utils/reportApiUtils", () => ({
  authorizeReportRequest: (...a: unknown[]) => mockAuthorize(...a),
}));

import {
  buildCoverageRows,
  directoryOf,
  handleCodePinCoverageReportPOST,
} from "./codePinCoverageReportUtils";

const connection = {
  id: 9,
  branch: "main",
  projectId: 42,
  repository: { id: 3, name: "acme/app", provider: "GITHUB" },
  project: { id: 42, name: "Web" },
};
const pin = (
  caseId: number,
  filePath: string,
  kind = "FILE",
  source = "MANUAL"
) => ({
  caseId,
  configId: 9,
  filePath,
  kind,
  source,
  case: { projectId: 42 },
});
const post = (path: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost/api/report-builder/${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("code pin coverage report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorize.mockResolvedValue({ ok: true, bypass: false });
    db.projectCodeRepositoryConfig.findMany.mockResolvedValue([connection]);
    db.repositoryCaseCodePin.findMany.mockResolvedValue([]);
    db.impactAnalysis.findMany.mockResolvedValue([]);
    db.repositoryCases.count.mockResolvedValue(10);
  });

  it("derives a two-level directory from paths and globs", () => {
    expect(directoryOf("src/payments/charge.ts")).toBe("src/payments");
    expect(directoryOf("src/payments/api/v2/charge.ts")).toBe("src/payments");
    expect(directoryOf("README.md")).toBe("/");
    expect(directoryOf("src/**/*.test.ts")).toBe("src");
    expect(directoryOf("/lib/auth/*.ts")).toBe("lib/auth");
  });

  it("buckets pins, stale pins from the latest analysis, and uncovered files by directory", () => {
    const rows = buildCoverageRows({
      connections: [connection],
      pins: [
        pin(1, "src/payments/charge.ts"),
        pin(2, "src/payments/refund.ts", "SYMBOL", "AI"),
        pin(1, "src/auth/login.ts", "RANGE", "ISSUE"),
        pin(3, "src/payments/**", "GLOB", "MAPFILE"),
        pin(4, "other/x.ts", "FILE", "MANUAL"),
        { ...pin(5, "x.ts"), configId: 99 },
      ] as any,
      analyses: [
        {
          id: 1,
          configId: 9,
          createdAt: new Date("2026-09-01"),
          result: {
            uncoveredFiles: ["src/checkout/cart.ts", "src/checkout/total.ts"],
            stalePins: [{ pinId: 7, filePath: "src/payments/refund.ts" }],
          },
        },
        {
          id: 2,
          configId: 9,
          createdAt: new Date("2026-09-05"),
          result: {
            uncoveredFiles: ["src/checkout/cart.ts", "src/auth/reset.ts"],
            stalePins: [
              { pinId: 8, filePath: "src/auth/login.ts" },
              { pinId: 8, filePath: "src/auth/login.ts" },
            ],
          },
        },
      ] as any,
      caseTotals: new Map([[42, 10]]),
      includeProject: true,
    });
    // Most uncovered files first, then most pins.
    expect(rows.map((r) => r.directory)).toEqual([
      "src/checkout",
      "src/auth",
      "src/payments",
      "other",
    ]);
    const payments = rows.find((r) => r.directory === "src/payments")!;
    expect(payments).toMatchObject({
      pinCount: 3,
      kindCounts: { FILE: 1, RANGE: 0, SYMBOL: 1, GLOB: 1 },
      sourceCounts: { MANUAL: 1, AI: 1, ANNOTATION: 0, MAPFILE: 1, ISSUE: 0 },
      caseCount: 3,
      stalePinCount: 0,
      uncoveredFileCount: 0,
      projectCaseTotal: 10,
      projectCasesWithPins: 4,
      project: { id: 42, name: "Web" },
    });
    const auth = rows.find((r) => r.directory === "src/auth")!;
    expect(auth).toMatchObject({
      pinCount: 1,
      stalePinCount: 1,
      uncoveredFileCount: 1,
      uncoveredAnalysisCount: 1,
    });
    const checkout = rows.find((r) => r.directory === "src/checkout")!;
    expect(checkout).toMatchObject({
      pinCount: 0,
      uncoveredFileCount: 2,
      uncoveredAnalysisCount: 2,
      sampleUncoveredFiles: ["src/checkout/cart.ts", "src/checkout/total.ts"],
    });
  });

  it("requires a project id, scopes queries, and applies the coverage filter", async () => {
    expect(
      (
        await handleCodePinCoverageReportPOST(
          post("code-pin-coverage", {}),
          false
        )
      ).status
    ).toBe(400);

    db.repositoryCaseCodePin.findMany.mockResolvedValue([pin(1, "src/a/b.ts")]);
    db.impactAnalysis.findMany.mockResolvedValue([
      {
        id: 1,
        configId: 9,
        createdAt: new Date(),
        result: { uncoveredFiles: ["src/z/y.ts"] },
      },
    ]);
    const res = await handleCodePinCoverageReportPOST(
      post("code-pin-coverage", {
        projectId: 42,
        lookbackDays: 30,
        configId: 9,
        coverageFilter: "gaps",
      }),
      false
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.lookbackDays).toBe(30);
    expect(body.data.map((r: any) => r.directory)).toEqual(["src/z"]);
    expect(
      db.projectCodeRepositoryConfig.findMany.mock.calls[0][0].where
    ).toMatchObject({ purpose: "IMPACT", projectId: 42, id: 9 });
    expect(db.impactAnalysis.findMany.mock.calls[0][0].where).toMatchObject({
      status: "COMPLETED",
      configId: { in: [9] },
    });
    expect(
      db.impactAnalysis.findMany.mock.calls[0][0].where.createdAt.gte
    ).toBeInstanceOf(Date);
    expect(db.repositoryCases.count).toHaveBeenCalledWith({
      where: { projectId: 42, isDeleted: false },
    });
  });

  it("scopes the cross-project report to projects with Impact enabled", async () => {
    const res = await handleCodePinCoverageReportPOST(
      post("cross-project-code-pin-coverage", {
        dimensions: ["project"],
        lookbackDays: 0,
      }),
      true
    );
    expect(res.status).toBe(200);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), {
      requiresAdmin: true,
      projectId: undefined,
    });
    expect(
      db.projectCodeRepositoryConfig.findMany.mock.calls[0][0].where
    ).toMatchObject({ project: { isDeleted: false, impactEnabled: true } });
    expect(
      db.impactAnalysis.findMany.mock.calls[0][0].where.createdAt
    ).toBeUndefined();
  });
});
