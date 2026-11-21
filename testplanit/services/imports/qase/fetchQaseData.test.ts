import { describe, expect, it, vi } from "vitest";
import type { DbClient } from "~/lib/zenstack";
import { fetchQaseData, QaseFetchCanceledError } from "./fetchQaseData";
import type { QaseClient } from "./qaseClient";

type Row = {
  jobId: string;
  projectCode: string | null;
  entity: string;
  sourceId: string;
  rowIndex: number;
  data: unknown;
};

function makeDb() {
  const rows: Row[] = [];
  const db = {
    qaseImportStaging: {
      deleteMany: vi.fn(async () => {
        rows.length = 0;
      }),
      createMany: vi.fn(async ({ data }: { data: Row[] }) => {
        rows.push(...data);
      }),
    },
  };
  return { db: db as unknown as DbClient, rows, raw: db };
}

/** A client whose answers come from a path → pages table. */
function makeClient(data: Record<string, unknown[][]>) {
  const client = {
    get: vi.fn(async (path: string) => data[path]?.[0] ?? []),
    pages: vi.fn(async function* (path: string) {
      const pages = data[path] ?? [[]];
      const total = pages.reduce((sum, entities) => sum + entities.length, 0);
      for (const entities of pages) {
        yield { total, entities };
      }
    }),
  };
  return client as unknown as QaseClient & typeof client;
}

describe("fetchQaseData", () => {
  it("stages workspace records once and project records per project", async () => {
    const { db, rows, raw } = makeDb();
    const client = makeClient({
      user: [[{ id: 1, email: "a@example.com" }]],
      system_field: [[{ slug: "priority" }, { slug: "severity" }]],
      "suite/DEMO": [[{ id: 1 }, { id: 2 }]],
      "suite/SEED": [[{ id: 1 }]],
      "case/DEMO": [[{ id: 10 }, { id: 11 }], [{ id: 12 }]],
      "shared_step/SEED": [[{ hash: "abc" }]],
      "result/SEED": [[{ hash: "r1" }]],
    });

    const progress = await fetchQaseData({
      db,
      client,
      jobId: "job-1",
      projectCodes: ["DEMO", "SEED"],
    });

    expect(raw.qaseImportStaging.deleteMany).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
    });
    expect(progress.case).toEqual({ fetched: 3, total: 3, done: true });
    expect(progress.suite).toEqual({ fetched: 3, total: 3, done: true });
    expect(progress.run).toEqual({ fetched: 0, total: 0, done: true });

    const suites = rows.filter((row) => row.entity === "suite");
    expect(
      suites.map((row) => [row.projectCode, row.sourceId, row.rowIndex])
    ).toEqual([
      ["DEMO", "1", 0],
      ["DEMO", "2", 1],
      ["SEED", "1", 2],
    ]);
    expect(rows.find((row) => row.entity === "user")?.projectCode).toBeNull();
    expect(
      rows.filter((row) => row.entity === "system_field").map((r) => r.sourceId)
    ).toEqual(["priority", "severity"]);
    expect(rows.find((row) => row.entity === "shared_step")?.sourceId).toBe(
      "abc"
    );
    expect(rows.find((row) => row.entity === "result")?.sourceId).toBe("r1");
  });

  it("asks for external issues on cases and related ids on runs", async () => {
    const { db } = makeDb();
    const client = makeClient({});

    await fetchQaseData({ db, client, jobId: "job-1", projectCodes: ["DEMO"] });

    expect(client.pages).toHaveBeenCalledWith("case/DEMO", {
      include: "external_issues",
    });
    expect(client.pages).toHaveBeenCalledWith("run/DEMO", {
      include: "cases,defects,external_issue",
    });
  });

  it("stops when the job is canceled", async () => {
    const { db, rows } = makeDb();
    const client = makeClient({
      "suite/DEMO": [[{ id: 1 }]],
      "case/DEMO": [[{ id: 10 }]],
    });
    let checks = 0;

    await expect(
      fetchQaseData({
        db,
        client,
        jobId: "job-1",
        projectCodes: ["DEMO"],
        isCanceled: async () => ++checks > 12,
      })
    ).rejects.toBeInstanceOf(QaseFetchCanceledError);

    expect(rows.some((row) => row.entity === "suite")).toBe(true);
    expect(rows.some((row) => row.entity === "case")).toBe(false);
  });

  it("reports progress after every page", async () => {
    const { db } = makeDb();
    const client = makeClient({ "case/DEMO": [[{ id: 1 }], [{ id: 2 }]] });
    const seen: number[] = [];

    await fetchQaseData({
      db,
      client,
      jobId: "job-1",
      projectCodes: ["DEMO"],
      onProgress: async (progress, entity) => {
        if (entity === "case") {
          seen.push(progress.case.fetched);
        }
      },
    });

    expect(seen).toEqual([0, 1, 2]);
  });
});
