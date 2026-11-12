// @vitest-environment node
import { createReadStream } from "node:fs";
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

  const datasetRowCounts = async (json: unknown) => {
    const summary = await analyze(JSON.stringify(json));
    return Object.fromEntries(
      Object.entries(summary.datasets).map(([name, dataset]) => [
        name,
        dataset.rowCount,
      ])
    );
  };

  it("reports only the export's datasets, not row fields or nested objects", async () => {
    const summary = await analyze(JSON.stringify(exportJson));

    expect(Object.keys(summary.datasets).sort()).toEqual(["projects", "users"]);
    expect(summary.meta.totalDatasets).toBe(2);
  });

  it("does not treat a row's last column as a dataset", async () => {
    expect(
      await datasetRowCounts({
        statuses: {
          data: [
            { id: 1, name: "Passed", color: "#00FF00" },
            { id: 2, name: "Failed", color: "#FF0000" },
          ],
        },
      })
    ).toEqual({ statuses: 2 });
  });

  it("does not count objects in a row's own data or items array as rows", async () => {
    const rows = [
      { id: 1, items: [{ sku: "a" }, { sku: "b" }], data: [{ k: 1 }] },
      { id: 2, rows: [{ n: 1 }], fields: { colour: "red" } },
    ];

    expect(await datasetRowCounts({ orders: { data: rows } })).toEqual({
      orders: 2,
    });
    expect(stagedRows()).toEqual({ orders: rows });
  });

  it("keeps a nested schema whole and does not read it as datasets", async () => {
    const schema = { id: { type: "integer" }, tags: { type: "array" } };
    const summary = await analyze(
      JSON.stringify({ users: { schema, data: [{ id: 1, tags: [] }] } })
    );

    expect(Object.keys(summary.datasets)).toEqual(["users"]);
    expect(summary.datasets.users.schema).toEqual(schema);
  });

  it("reads a dataset named like a schema key as a dataset with its own schema", async () => {
    const fields = {
      schema: { id: "id", display_name: "string" },
      data: [{ id: 5, display_name: "Severity" }],
    };
    const summary = await analyze(JSON.stringify({ fields }));

    expect(summary.datasets.fields.rowCount).toBe(1);
    expect(summary.datasets.fields.schema).toEqual(fields.schema);
    expect(stagedRows()).toEqual({ fields: fields.data });
  });

  it("reports an empty dataset with no rows", async () => {
    expect(
      await datasetRowCounts({
        users: { data: [{ id: 1 }] },
        runs: { data: [] },
      })
    ).toEqual({ users: 1, runs: 0 });
  });

  describe("sample exports", () => {
    const analyzeFile = async (name: string) => {
      const summary = await analyzeTestmoExport(
        createReadStream(`test/test-data/testmo/testmo-export-${name}.json`),
        "job-1",
        {} as never
      );
      return Object.fromEntries(
        Object.entries(summary.datasets).map(([key, dataset]) => [
          key,
          dataset.rowCount,
        ])
      );
    };

    it("reads the datasets of a plain export", async () => {
      expect(await analyzeFile("sample-small")).toEqual({
        users: 2,
        statuses: 2,
        repository_cases: 3,
        runs: 0,
      });
    });

    it("reads datasets under a container key and ignores meta", async () => {
      expect(await analyzeFile("with-container")).toEqual({
        users: 2,
        projects: 1,
      });
    });

    it("reads datasets whose names are also schema keywords", async () => {
      expect(await analyzeFile("template-fields")).toEqual({
        fields: 1,
        field_values: 3,
        template_fields: 1,
      });
    });
  });
});
