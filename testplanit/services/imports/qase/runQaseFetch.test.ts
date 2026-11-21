import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DbClient } from "~/lib/zenstack";

vi.mock("~/utils/encryption", () => ({
  decrypt: vi.fn(async (value: string) => value.replace("enc:", "")),
}));

import { runQaseFetch } from "./runQaseFetch";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function makeDb(job: Record<string, unknown> | null) {
  const state = { job: job ? { ...job } : null, staged: 0 };
  const db = {
    qaseImportJob: {
      findUnique: vi.fn(async () => state.job),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.job = { ...state.job, ...data };
        return state.job;
      }),
    },
    qaseImportStaging: {
      deleteMany: vi.fn(async () => {
        state.staged = 0;
      }),
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        state.staged += data.length;
      }),
    },
  };
  return { db: db as unknown as DbClient, state, raw: db };
}

const baseJob = {
  id: "job-1",
  apiHost: "api.qase.io",
  apiToken: "enc:secret-token",
  projects: [{ code: "DEMO", title: "Demo" }],
  cancelRequested: false,
};

const clientOptions = (fetchImpl: unknown) => ({
  fetchImpl: fetchImpl as typeof fetch,
  sleep: async () => {},
  lookup: async () => ["93.184.216.34"],
});

describe("runQaseFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stages the data and leaves the job ready with its token", async () => {
    const { db, state } = makeDb(baseJob);
    const fetchImpl = vi.fn(async (url: URL) => {
      if (url.pathname === "/v1/system_field") {
        return json({ status: true, result: [{ slug: "priority" }] });
      }
      const entities = url.pathname === "/v1/case/DEMO" ? [{ id: 1 }] : [];
      return json({
        status: true,
        result: { total: entities.length, entities },
      });
    });

    await runQaseFetch({
      db,
      jobId: "job-1",
      clientOptions: clientOptions(fetchImpl),
    });

    expect(state.job).toMatchObject({
      status: "READY",
      phase: "CONFIGURING",
      currentEntity: null,
      apiToken: "enc:secret-token",
    });
    expect(state.staged).toBe(2);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.headers).toMatchObject({ Token: "secret-token" });
  });

  it("marks the job failed, keeps the token for a retry and rethrows", async () => {
    const { db, state } = makeDb(baseJob);
    const fetchImpl = vi.fn(async () => json({}, 401));

    await expect(
      runQaseFetch({
        db,
        jobId: "job-1",
        clientOptions: clientOptions(fetchImpl),
      })
    ).rejects.toMatchObject({ code: "unauthorized" });

    expect(state.job).toMatchObject({
      status: "FAILED",
      error: "Qase rejected the API token.",
      apiToken: "enc:secret-token",
    });
  });

  it("cancels before starting when cancel was already requested", async () => {
    const { db, state, raw } = makeDb({ ...baseJob, cancelRequested: true });
    const fetchImpl = vi.fn();

    await runQaseFetch({
      db,
      jobId: "job-1",
      clientOptions: clientOptions(fetchImpl),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.job).toMatchObject({ status: "CANCELED", apiToken: null });
    expect(raw.qaseImportStaging.deleteMany).toHaveBeenCalled();
  });

  it("removes staged data and the token when canceled part-way", async () => {
    const { db, state } = makeDb(baseJob);
    let requests = 0;
    const fetchImpl = vi.fn(async (url: URL) => {
      requests += 1;
      if (requests === 3) {
        state.job = { ...state.job, cancelRequested: true };
      }
      if (url.pathname === "/v1/system_field") {
        return json({ status: true, result: [{ slug: "priority" }] });
      }
      return json({
        status: true,
        result: { total: 1, entities: [{ id: 1 }] },
      });
    });

    await runQaseFetch({
      db,
      jobId: "job-1",
      clientOptions: clientOptions(fetchImpl),
    });

    expect(state.job).toMatchObject({ status: "CANCELED", apiToken: null });
    expect(state.staged).toBe(0);
    expect(requests).toBeLessThan(6);
  });

  it("throws when the job does not exist", async () => {
    const { db } = makeDb(null);
    await expect(runQaseFetch({ db, jobId: "missing" })).rejects.toThrow(
      "not found"
    );
  });
});
