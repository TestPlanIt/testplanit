import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  queueAdd: vi.fn(),
  queue: vi.fn(),
  listProjects: vi.fn(),
  enqueue: vi.fn(),
  db: {
    qaseImportJob: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("next-auth/next", () => ({ getServerSession: mocks.session }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("~/lib/queues", () => ({ getQaseImportQueue: mocks.queue }));
vi.mock("~/lib/multiTenantDb", () => ({ getCurrentTenantId: () => undefined }));
vi.mock("~/lib/auditContextEnqueue", () => ({
  enqueueWithAuditContext: mocks.enqueue,
}));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: unknown) => handler,
}));
vi.mock("~/lib/db/requestRouting", () => ({
  withRequestRouting: (handler: unknown) => handler,
}));
vi.mock("~/utils/encryption", () => ({
  encrypt: vi.fn(async (value: string) => `enc:${value}`),
}));
vi.mock("~/services/imports/qase/jobPresenter", async (original) => ({
  ...(await original<typeof import("~/services/imports/qase/jobPresenter")>()),
  listQaseProjects: mocks.listProjects,
}));

import { QaseApiError } from "~/services/imports/qase/qaseClient";
import { DELETE as deleteJob, POST as postAction } from "./[jobId]/route";
import { GET, POST } from "./route";

const admin = { user: { id: "admin-1", access: "ADMIN" } };
const request = (
  body?: unknown,
  url = "http://localhost/api/imports/qase/jobs"
) =>
  new NextRequest(url, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const context = { params: Promise.resolve({ jobId: "job-1" }) };

const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  status: "QUEUED",
  phase: "FETCHING",
  statusMessage: "Queued",
  error: null,
  apiHost: "api.qase.io",
  projects: [{ code: "DEMO", title: "Demo" }],
  fetchProgress: null,
  currentEntity: null,
  cancelRequested: false,
  createdAt: new Date("2026-11-20T10:00:00Z"),
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  durationMs: null,
  ...overrides,
});

const demo = {
  code: "DEMO",
  title: "Demo",
  cases: 5,
  suites: 1,
  milestones: 0,
  runs: 0,
  defects: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue(admin);
  mocks.queue.mockReturnValue({ add: mocks.queueAdd });
  mocks.listProjects.mockResolvedValue([demo]);
  mocks.db.qaseImportJob.create.mockImplementation(async ({ data }) =>
    jobRow(data)
  );
});

describe("POST /api/imports/qase/jobs", () => {
  it("rejects a user who is not an administrator", async () => {
    mocks.session.mockResolvedValue({ user: { id: "u", access: "USER" } });
    const response = await POST(
      request({ token: "t", projectCodes: ["DEMO"] })
    );
    expect(response.status).toBe(401);
    expect(mocks.db.qaseImportJob.create).not.toHaveBeenCalled();
  });

  it("requires a token and at least one project", async () => {
    expect((await POST(request({ projectCodes: ["DEMO"] }))).status).toBe(400);
    expect((await POST(request({ token: "t", projectCodes: [] }))).status).toBe(
      400
    );
  });

  it("stores the token encrypted, queues the fetch and never returns the token", async () => {
    const response = await POST(
      request({ token: " secret-token ", projectCodes: ["DEMO"] })
    );

    expect(response.status).toBe(201);
    const created = mocks.db.qaseImportJob.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      createdById: "admin-1",
      apiHost: "api.qase.io",
      apiToken: "enc:secret-token",
      projects: [demo],
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      "process-qase-import",
      expect.objectContaining({ jobId: "job-1", mode: "fetch" })
    );
    const text = await response.text();
    expect(text).not.toContain("secret-token");
    expect(JSON.parse(text).job).not.toHaveProperty("apiToken");
  });

  it("refuses a project the token cannot read", async () => {
    const response = await POST(
      request({ token: "t", projectCodes: ["DEMO", "OTHER"] })
    );
    expect(response.status).toBe(400);
    expect(mocks.db.qaseImportJob.create).not.toHaveBeenCalled();
  });

  it("passes a Qase failure on with its code", async () => {
    mocks.listProjects.mockRejectedValue(
      new QaseApiError("unauthorized", "Qase rejected the API token.", 401)
    );
    const response = await POST(
      request({ token: "t", projectCodes: ["DEMO"] })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "unauthorized" });
  });

  it("answers 503 when the queue is unavailable", async () => {
    mocks.queue.mockReturnValue(null);
    const response = await POST(
      request({ token: "t", projectCodes: ["DEMO"] })
    );
    expect(response.status).toBe(503);
  });
});

describe("GET /api/imports/qase/jobs", () => {
  it("lists the caller's jobs, newest first", async () => {
    mocks.db.qaseImportJob.findMany.mockResolvedValue([jobRow()]);
    const response = await GET(
      new NextRequest("http://localhost/api/imports/qase/jobs?limit=500")
    );
    expect(mocks.db.qaseImportJob.findMany).toHaveBeenCalledWith({
      where: { createdById: "admin-1" },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    expect((await response.json()).jobs).toHaveLength(1);
  });
});

describe("POST /api/imports/qase/jobs/[jobId]", () => {
  it("requests cancellation of a running job", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue({
      id: "job-1",
      status: "RUNNING",
      cancelRequested: false,
      apiToken: "enc:t",
    });
    mocks.db.qaseImportJob.update.mockResolvedValue(
      jobRow({ status: "RUNNING", cancelRequested: true })
    );

    const response = await postAction(request({ action: "cancel" }), context);

    expect(response.status).toBe(200);
    expect(mocks.db.qaseImportJob.update.mock.calls[0][0].data).toMatchObject({
      cancelRequested: true,
    });
  });

  it("does not cancel a finished job", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue({
      id: "job-1",
      status: "READY",
      cancelRequested: false,
      apiToken: "enc:t",
    });
    const response = await postAction(request({ action: "cancel" }), context);
    expect(response.status).toBe(400);
  });

  it("re-queues a failed job that still has its token", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue({
      id: "job-1",
      status: "FAILED",
      cancelRequested: false,
      apiToken: "enc:t",
    });
    mocks.db.qaseImportJob.update.mockResolvedValue(jobRow());

    const response = await postAction(request({ action: "retry" }), context);

    expect(response.status).toBe(200);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("continues a failed import instead of fetching again", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue({
      id: "job-1",
      status: "FAILED",
      phase: "IMPORTING",
      cancelRequested: false,
      apiToken: "enc:token",
    });
    mocks.db.qaseImportJob.update.mockResolvedValue(
      jobRow({ phase: "IMPORTING" })
    );

    const response = await postAction(request({ action: "retry" }), context);

    expect(response.status).toBe(200);
    const update = mocks.db.qaseImportJob.update.mock.calls[0][0];
    expect(update.data.phase).toBe("IMPORTING");
    expect(update.data).not.toHaveProperty("fetchProgress");
    expect(update.data).not.toHaveProperty("entityProgress");
    expect(mocks.enqueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({ jobId: "job-1", mode: "import" })
    );
  });

  it("does not retry a canceled job, whose token is gone", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue({
      id: "job-1",
      status: "CANCELED",
      cancelRequested: true,
      apiToken: null,
    });
    const response = await postAction(request({ action: "retry" }), context);
    expect(response.status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/imports/qase/jobs/[jobId]", () => {
  it("deletes a finished job", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue({ status: "READY" });
    const response = await deleteJob(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.db.qaseImportJob.delete).toHaveBeenCalledWith({
      where: { id: "job-1" },
    });
  });

  it("refuses to delete a running job", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue({ status: "RUNNING" });
    const response = await deleteJob(request(), context);
    expect(response.status).toBe(400);
    expect(mocks.db.qaseImportJob.delete).not.toHaveBeenCalled();
  });
});
