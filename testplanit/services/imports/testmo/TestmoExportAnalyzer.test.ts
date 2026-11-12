import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeTestmoExport } from "./TestmoExportAnalyzer";

const { stageBatch } = vi.hoisted(() => ({
  stageBatch: vi.fn(
    async (
      _jobId: string,
      _datasetName: string,
      _batch: Array<{ index: number; data: unknown }>
    ) => undefined
  ),
}));

vi.mock("./TestmoStagingService", () => ({
  TestmoStagingService: class {
    stageBatch = stageBatch;
  },
}));

const exportJson = {
  users: {
    schema: { id: "integer", name: "string", tags: "array" },
    data: [
      { id: 1, name: "Ada", tags: ["admin", "qa"], active: true },
      { id: 2, name: 'Zoë "Z" 測試', tags: [], active: false },
      { id: 3, name: null, profile: { team: { id: 7, lead: "Mia" } } },
    ],
  },
  projects: {
    data: [{ id: 10, name: "Checkout", ratio: 0.75, count: -3 }],
  },
};

const analyze = (json: string, chunkSize = json.length) => {
  const pieces: string[] = [];
  for (let i = 0; i < json.length; i += chunkSize) {
    pieces.push(json.slice(i, i + chunkSize));
  }
  return analyzeTestmoExport(Readable.from(pieces), "job-1", {} as never);
};

const stagedRows = () => {
  const byDataset: Record<string, unknown[]> = {};
  for (const [, datasetName, batch] of stageBatch.mock.calls) {
    for (const row of batch) {
      (byDataset[datasetName] ??= [])[row.index] = row.data;
    }
  }
  return byDataset;
};

describe("analyzeTestmoExport", () => {
  beforeEach(() => {
    stageBatch.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("counts each dataset's rows and captures its schema", async () => {
    const summary = await analyze(JSON.stringify(exportJson));

    expect(summary.datasets.users.rowCount).toBe(3);
    expect(summary.datasets.users.schema).toEqual(exportJson.users.schema);
    expect(summary.datasets.projects.rowCount).toBe(1);
    expect(summary.meta.totalRows).toBe(4);
  });

  it("stages every row exactly as it appears in the export", async () => {
    await analyze(JSON.stringify(exportJson));

    expect(stageBatch.mock.calls.every(([jobId]) => jobId === "job-1")).toBe(
      true
    );
    expect(stagedRows()).toEqual({
      users: exportJson.users.data,
      projects: exportJson.projects.data,
    });
  });

  it("assembles the same rows when the file arrives in small pieces", async () => {
    await analyze(JSON.stringify(exportJson), 7);

    expect(stagedRows()).toEqual({
      users: exportJson.users.data,
      projects: exportJson.projects.data,
    });
  });
});
