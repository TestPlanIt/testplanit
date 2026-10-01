import { describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  hashReportBuilderState,
  REPORT_BUILDER_STATE_RETENTION_DAYS,
  sweepReportBuilderStates,
} from "./reportBuilderState";

describe("canonicalJson", () => {
  it("sorts object keys recursively and keeps array order", () => {
    expect(
      canonicalJson({
        metrics: ["b", "a"],
        dimensionFilters: { testRun: [3, 1, 2], status: ["x"] },
        dimensions: ["status", "testRun"],
      })
    ).toBe(
      '{"dimensionFilters":{"status":["x"],"testRun":[3,1,2]},"dimensions":["status","testRun"],"metrics":["b","a"]}'
    );
  });

  it("drops undefined values so an absent key and an undefined key match", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });
});

describe("hashReportBuilderState", () => {
  const config = {
    dimensions: ["testRun"],
    metrics: ["testCaseCount"],
    dimensionFilters: { testRun: [1, 2] },
  };

  it("is stable across key order", () => {
    const reordered = {
      dimensionFilters: { testRun: [1, 2] },
      metrics: ["testCaseCount"],
      dimensions: ["testRun"],
    };
    expect(hashReportBuilderState("test-execution", reordered)).toBe(
      hashReportBuilderState("test-execution", config)
    );
  });

  it("changes with the report type and with the selection", () => {
    const base = hashReportBuilderState("test-execution", config);
    expect(hashReportBuilderState("repository-stats", config)).not.toBe(base);
    expect(
      hashReportBuilderState("test-execution", {
        ...config,
        dimensionFilters: { testRun: [1, 2, 3] },
      })
    ).not.toBe(base);
  });

  it("is a sha256 hex digest", () => {
    expect(hashReportBuilderState("test-execution", config)).toMatch(
      /^[0-9a-f]{64}$/
    );
  });
});

describe("sweepReportBuilderStates", () => {
  function clientWithBatches(batches: number[]) {
    const executeRaw = vi.fn();
    for (const n of batches) executeRaw.mockResolvedValueOnce(n);
    return { client: { $executeRaw: executeRaw } as any, executeRaw };
  }

  it("deletes in batches until a short batch and reports the total", async () => {
    const { client, executeRaw } = clientWithBatches([1000, 1000, 250]);
    const result = await sweepReportBuilderStates(client);
    expect(result.deleted).toBe(2250);
    expect(executeRaw).toHaveBeenCalledTimes(3);
  });

  it("stops after one empty batch when nothing is stale", async () => {
    const { client, executeRaw } = clientWithBatches([0]);
    const result = await sweepReportBuilderStates(client);
    expect(result.deleted).toBe(0);
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("cuts off at the retention window and skips rows a share link references", async () => {
    const { client, executeRaw } = clientWithBatches([0]);
    const now = new Date("2026-09-30T12:00:00Z");
    const result = await sweepReportBuilderStates(client, { now });

    const expectedCutoff = new Date(
      now.getTime() - REPORT_BUILDER_STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    expect(result.cutoff).toEqual(expectedCutoff);

    const [strings, ...values] = executeRaw.mock.calls[0];
    const sql = strings.join("?");
    expect(sql).toContain('DELETE FROM "ReportBuilderState"');
    expect(sql).toContain('"lastUsedAt" < ?');
    expect(sql).toContain(`l."entityConfig"->>'stateId' = s.id`);
    expect(values[0]).toEqual(expectedCutoff);
  });

  it("honors an explicit retention override", async () => {
    const { client } = clientWithBatches([0]);
    const now = new Date("2026-09-30T12:00:00Z");
    const result = await sweepReportBuilderStates(client, {
      now,
      retentionDays: 1,
    });
    expect(result.cutoff).toEqual(new Date("2026-09-29T12:00:00Z"));
  });
});
