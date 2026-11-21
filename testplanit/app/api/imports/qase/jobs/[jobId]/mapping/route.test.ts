import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QaseAnalysis } from "~/services/imports/qase/mapping";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  analysis: vi.fn(),
  db: { qaseImportJob: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("next-auth/next", () => ({ getServerSession: mocks.session }));
vi.mock("~/server/auth", () => ({ authOptions: {} }));
vi.mock("~/server/db", () => ({ db: mocks.db }));
vi.mock("~/lib/rawDb", () => ({ rawDb: {} }));
vi.mock("~/lib/auditContextWrappers", () => ({
  withAuditContext: (handler: unknown) => handler,
}));
vi.mock("~/lib/db/requestRouting", () => ({
  withRequestRouting: (handler: unknown) => handler,
}));
vi.mock("~/services/imports/qase/analysis", () => ({
  buildQaseAnalysis: mocks.analysis,
}));

import { GET, PUT } from "./route";

const admin = { user: { id: "admin-1", access: "ADMIN" } };
const context = { params: Promise.resolve({ jobId: "job-1" }) };
const url = "http://localhost/api/imports/qase/jobs/job-1/mapping";
const get = () => new NextRequest(url);
const put = (body: unknown) =>
  new NextRequest(url, { method: "PUT", body: JSON.stringify(body) });

const analysis: QaseAnalysis = {
  source: {
    projects: [
      {
        code: "SHOP",
        title: "Shop",
        cases: 2,
        suites: 1,
        milestones: 0,
        runs: 0,
        defects: 0,
      },
    ],
    users: [],
    caseStatuses: [{ id: "0", title: "Actual" }],
    fields: [
      {
        key: "system:priority",
        title: "Priority",
        targetType: "Dropdown",
        options: [{ id: "1", title: "High" }],
      },
    ],
  },
  existing: {
    projects: [{ id: 7, name: "Shop" }],
    users: [],
    workflows: [
      {
        id: 3,
        name: "Active",
        isDefault: true,
        icon: { name: "circle" },
        color: { value: "#000000" },
      },
    ],
    templates: [],
    caseFields: [
      {
        id: 11,
        displayName: "Priority",
        systemName: "priority",
        type: "Dropdown",
        options: [{ id: 21, name: "High" }],
      },
    ],
  },
  storageConfigured: true,
};

const readyJob = (overrides: Record<string, unknown> = {}) => ({
  id: "job-1",
  status: "READY",
  phase: "CONFIGURING",
  projects: analysis.source.projects,
  configuration: null,
  ...overrides,
});

describe("Qase mapping route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue(admin);
    mocks.analysis.mockResolvedValue(analysis);
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(readyJob());
    mocks.db.qaseImportJob.update.mockResolvedValue({});
  });

  it("refuses anyone who is not an administrator", async () => {
    mocks.session.mockResolvedValue({ user: { id: "u", access: "USER" } });

    expect((await GET(get(), context)).status).toBe(401);
    expect((await PUT(put({ configuration: {} }), context)).status).toBe(401);
    expect(mocks.db.qaseImportJob.findUnique).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown job", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(null);

    expect((await GET(get(), context)).status).toBe(404);
  });

  it("refuses a job whose data is not staged", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(
      readyJob({ status: "COMPLETED", phase: null })
    );

    expect((await GET(get(), context)).status).toBe(400);
    expect((await PUT(put({ configuration: {} }), context)).status).toBe(400);
    expect(mocks.db.qaseImportJob.update).not.toHaveBeenCalled();
  });

  it("opens with a mapping matched by name when none is saved", async () => {
    const response = await GET(get(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.configuration.projects.SHOP).toEqual({ mappedTo: 7 });
    expect(body.configuration.fields["system:priority"]).toEqual({
      action: "map",
      mappedTo: 11,
      name: "",
    });
    expect(body.configuration.template).toEqual({
      action: "create",
      mappedTo: null,
      name: "Qase",
    });
    expect(body.problems).toEqual([]);
  });

  it("returns the saved mapping and what is wrong with it", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(
      readyJob({
        configuration: {
          projects: { SHOP: { mappedTo: 999 } },
          caseStatuses: { "0": { mappedTo: 3 } },
          template: { action: "create", name: "Qase" },
          fields: { "system:priority": { action: "skip" } },
        },
      })
    );

    const body = await (await GET(get(), context)).json();

    expect(body.configuration.projects.SHOP).toEqual({ mappedTo: 999 });
    expect(body.problems).toEqual([
      { code: "project_unmapped", subject: "Shop" },
    ]);
  });

  it("allows mapping a job whose import failed", async () => {
    mocks.db.qaseImportJob.findUnique.mockResolvedValue(
      readyJob({ status: "FAILED", phase: "IMPORTING" })
    );

    expect((await GET(get(), context)).status).toBe(200);
  });

  it("requires a mapping in the body", async () => {
    expect((await PUT(put({}), context)).status).toBe(400);
    expect(mocks.db.qaseImportJob.update).not.toHaveBeenCalled();
  });

  it("saves the mapping after dropping what it does not understand", async () => {
    const response = await PUT(
      put({
        configuration: {
          projects: { SHOP: { mappedTo: 7, extra: true } },
          caseStatuses: { "0": { mappedTo: "3" } },
          template: { action: "create", name: "  Qase  " },
          fields: { "system:priority": { action: "map", mappedTo: 11 } },
          unknown: 1,
        },
      }),
      context
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    const saved = mocks.db.qaseImportJob.update.mock.calls[0][0];
    expect(saved.where).toEqual({ id: "job-1" });
    expect(saved.data.configuration).toEqual({
      projects: { SHOP: { mappedTo: 7 } },
      users: {},
      caseStatuses: { "0": { mappedTo: null } },
      template: { action: "create", mappedTo: null, name: "Qase" },
      fields: {
        "system:priority": { action: "map", mappedTo: 11, name: "" },
      },
    });
    expect(body.problems).toEqual([
      { code: "status_unmapped", subject: "Actual" },
    ]);
  });
});
