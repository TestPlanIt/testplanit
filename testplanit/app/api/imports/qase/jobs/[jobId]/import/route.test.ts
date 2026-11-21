import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  analysis: vi.fn(),
  queue: vi.fn(),
  enqueue: vi.fn(),
  db: { qaseImportJob: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("next-auth/next", () => ({ getServerSession: mocks.session }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("~/lib/rawDb", () => ({ rawDb: {} }));
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
vi.mock("~/services/imports/qase/analysis", () => ({
  buildQaseAnalysis: mocks.analysis,
}));

import { POST } from "./route";

const admin = { user: { id: "admin-1", access: "ADMIN" } };
const context = { params: Promise.resolve({ jobId: "job-1" }) };
const post = () =>
  new NextRequest("http://localhost/api/imports/qase/jobs/job-1/import", {
    method: "POST",
  });

const projects = [
  {
    code: "SHOP",
    title: "Shop",
    cases: 1,
    suites: 0,
    milestones: 0,
    runs: 0,
    defects: 0,
  },
];
const analysis = {
  source: { projects, users: [], caseStatuses: [], fields: [] },
  existing: {
    projects: [{ id: 7, name: "Shop" }],
    users: [],
    workflows: [],
    templates: [],
    caseFields: [],
    roles: [],
  },
  storageConfigured: true,
};
const configuration = {
  projects: { SHOP: { mappedTo: 7 } },
  users: {},
  caseStatuses: {},
  template: { action: "create", mappedTo: null, name: "Qase" },
  fields: {},
};
const jobRow = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  status: "READY",
  projects,
  configuration,
  ...overrides,
});
const queuedRow = {
  id: "job-1",
  status: "QUEUED",
  phase: "IMPORTING",
  statusMessage: "Queued",
  error: null,
  apiHost: "api.qase.io",
  projects,
  fetchProgress: null,
  currentEntity: null,
  cancelRequested: false,
  createdAt: new Date("2026-11-20T10:00:00Z"),
  startedAt: null,
  completedAt: null,
  canceledAt: null,
  durationMs: null,
  entityProgress: {},
  activityLog: [],
  configuration,
};

describe("Qase start-import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(admin);
    mocks.analysis.mockResolvedValue(analysis);
    mocks.queue.mockReturnValue({ name: "qase-imports" });
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(jobRow());
    mocks.db.qaseImportJob.update.mockResolvedValue(queuedRow);
  });

  const expectNotStarted = () => {
    expect(mocks.db.qaseImportJob.update).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  };

  it("refuses anyone who is not an administrator", async () => {
    mocks.session.mockResolvedValue(null);

    expect((await POST(post(), context)).status).toBe(401);
    expectNotStarted();
  });

  it("answers 404 for an unknown job", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(null);

    expect((await POST(post(), context)).status).toBe(404);
    expectNotStarted();
  });

  it("refuses a job that is not ready", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(
      jobRow({ status: "RUNNING" })
    );

    expect((await POST(post(), context)).status).toBe(400);
    expectNotStarted();
  });

  it("refuses a job without a saved mapping", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(
      jobRow({ configuration: null })
    );

    const response = await POST(post(), context);

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("mapping_missing");
    expectNotStarted();
  });

  it("refuses an incomplete mapping and says what is missing", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(
      jobRow({
        configuration: { ...configuration, projects: { SHOP: {} } },
      })
    );

    const response = await POST(post(), context);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("mapping_incomplete");
    expect(body.problems).toEqual([
      { code: "project_unmapped", subject: "Shop" },
    ]);
    expectNotStarted();
  });

  it("answers 503 when there is no queue", async () => {
    mocks.queue.mockReturnValue(null);

    const response = await POST(post(), context);

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("queue_unavailable");
    expectNotStarted();
  });

  it("queues the import and clears the earlier progress", async () => {
    const response = await POST(post(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.db.qaseImportJob.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: expect.objectContaining({
        status: "QUEUED",
        phase: "IMPORTING",
        cancelRequested: false,
        error: null,
        entityProgress: {},
        activityLog: [],
      }),
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(
      { name: "qase-imports" },
      expect.any(String),
      { jobId: "job-1", mode: "import", tenantId: undefined }
    );
    expect(body.job.status).toBe("QUEUED");
    expect(body.job.phase).toBe("IMPORTING");
  });
});
