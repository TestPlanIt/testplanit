import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

const mocks = vi.hoisted(() => ({
  repositoryCasesFindFirst: vi.fn(),
  dataSetFindFirst: vi.fn(),
  dataSetVersionFindFirst: vi.fn(),
  testCaseParameterFindMany: vi.fn(),
  assignmentFindUnique: vi.fn(),
  txAssignmentUpsert: vi.fn(),
  txAssignmentDelete: vi.fn(),
  captureAuditEvent: vi.fn(async () => undefined) as unknown as ReturnType<
    typeof vi.fn<(...args: any[]) => Promise<void>>
  >,
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    repositoryCases: { findFirst: mocks.repositoryCasesFindFirst },
    dataSet: { findFirst: mocks.dataSetFindFirst },
    dataSetVersion: { findFirst: mocks.dataSetVersionFindFirst },
    testCaseParameter: { findMany: mocks.testCaseParameterFindMany },
    caseSharedDataSetAssignment: { findUnique: mocks.assignmentFindUnique },
  })),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    $transaction: async (cb: any) =>
      cb({
        caseSharedDataSetAssignment: {
          upsert: mocks.txAssignmentUpsert,
          delete: mocks.txAssignmentDelete,
        },
      }),
  },
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mocks.captureAuditEvent(...args),
}));

import { getServerSession } from "next-auth";

import { DELETE, PUT } from "./route";

const session = { user: { id: "user-1", name: "Tester" } };

const buildPut = (
  caseId: string,
  body: unknown
): [NextRequest, { params: Promise<{ caseId: string }> }] => {
  const url = `http://localhost/api/repository/cases/${caseId}/shared-dataset`;
  const req = new NextRequest(url, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return [req, { params: Promise.resolve({ caseId }) }];
};

const buildDelete = (
  caseId: string
): [NextRequest, { params: Promise<{ caseId: string }> }] => {
  const url = `http://localhost/api/repository/cases/${caseId}/shared-dataset`;
  const req = new NextRequest(url, { method: "DELETE" });
  return [req, { params: Promise.resolve({ caseId }) }];
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/repository/cases/[caseId]/shared-dataset", () => {
  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildPut("1", {});
    const res = await PUT(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-numeric caseId", async () => {
    (getServerSession as any).mockResolvedValue(session);
    const [req, ctx] = buildPut("x", {});
    const res = await PUT(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 422 for invalid payload (missing sharedDataSetId)", async () => {
    (getServerSession as any).mockResolvedValue(session);
    const [req, ctx] = buildPut("1", { mappingJson: {} });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(422);
  });

  it("upserts the assignment with valid payload (Amendment A: no owner-dataset refusal)", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({
      id: 10,
      projectId: 1,
      name: "Login case",
    });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      isShared: true,
      name: "Credentials dataset",
    });
    mocks.dataSetVersionFindFirst.mockResolvedValue({
      id: 50,
      dataSetId: 7,
      parametersJson: [{ name: "email" }, { name: "password" }],
      rowsJson: [],
    });
    mocks.testCaseParameterFindMany.mockResolvedValue([
      { name: "email", required: true },
      { name: "password", required: true },
    ]);
    mocks.txAssignmentUpsert.mockResolvedValue({
      id: 99,
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      mappingJson: { email: "email", password: "password" },
    });

    const [req, ctx] = buildPut("10", {
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      mappingJson: { email: "email", password: "password" },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.assignment.id).toBe(99);

    // The route NEVER reads the case's owner dataset to refuse a PUT —
    // Amendment A locks coexistence as the documented behavior.
    expect(mocks.txAssignmentUpsert).toHaveBeenCalledTimes(1);
  });

  it("Amendment A: PUT against case WITH an owner dataset still SUCCEEDS (no 422 refusal)", async () => {
    (getServerSession as any).mockResolvedValue(session);
    // The route doesn't query an owner dataset at all — owner+shared
    // coexistence is allowed by design. We assert success even when the
    // case is one that would have an owner dataset (the route doesn't
    // care about that distinction).
    mocks.repositoryCasesFindFirst.mockResolvedValue({ id: 10, projectId: 1 });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      isShared: true,
    });
    mocks.dataSetVersionFindFirst.mockResolvedValue({
      id: 50,
      dataSetId: 7,
      parametersJson: [{ name: "email" }],
      rowsJson: [],
    });
    mocks.testCaseParameterFindMany.mockResolvedValue([
      { name: "email", required: true },
    ]);
    mocks.txAssignmentUpsert.mockResolvedValue({
      id: 100,
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      mappingJson: { email: "email" },
    });

    const [req, ctx] = buildPut("10", {
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      mappingJson: { email: "email" },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(200);
    expect(mocks.txAssignmentUpsert).toHaveBeenCalledTimes(1);
  });

  it("returns 422 cross_project when shared dataset belongs to a different project", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({ id: 10, projectId: 1 });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 999, // different project
      isShared: true,
    });

    const [req, ctx] = buildPut("10", {
      sharedDataSetId: 7,
      pinnedVersionId: null,
      mappingJson: {},
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("cross_project");
    // Schema policy is the second line of defense — this test pins down
    // the route-layer guard that runs first.
    expect(mocks.txAssignmentUpsert).not.toHaveBeenCalled();
  });

  it("returns 422 not_shared when the target dataset is an owner dataset", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({ id: 10, projectId: 1 });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      isShared: false, // owner dataset
    });

    const [req, ctx] = buildPut("10", {
      sharedDataSetId: 7,
      pinnedVersionId: null,
      mappingJson: {},
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("not_shared");
  });

  it("returns 422 required_unmapped with the missing names when a required parameter has no mapped column", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({ id: 10, projectId: 1 });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      isShared: true,
    });
    mocks.dataSetVersionFindFirst.mockResolvedValue({
      id: 50,
      dataSetId: 7,
      parametersJson: [{ name: "email" }, { name: "password" }],
      rowsJson: [],
    });
    mocks.testCaseParameterFindMany.mockResolvedValue([
      { name: "email", required: true },
      { name: "password", required: true },
    ]);

    const [req, ctx] = buildPut("10", {
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      // Only email mapped; password is required but unmapped.
      mappingJson: { email: "email" },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("required_unmapped");
    expect(json.missing).toEqual(["password"]);
    expect(mocks.txAssignmentUpsert).not.toHaveBeenCalled();
  });

  it("returns 422 unknown_columns when mapping references columns not on the version", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({ id: 10, projectId: 1 });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      isShared: true,
    });
    mocks.dataSetVersionFindFirst.mockResolvedValue({
      id: 50,
      dataSetId: 7,
      parametersJson: [{ name: "email" }],
      rowsJson: [],
    });
    mocks.testCaseParameterFindMany.mockResolvedValue([
      { name: "email", required: false },
    ]);

    const [req, ctx] = buildPut("10", {
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      mappingJson: { phantom_col: "email" },
    });
    const res = await PUT(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("unknown_columns");
    expect(json.columns).toEqual(["phantom_col"]);
  });

  it("emits an audit event with mappingColumns (KEYS only — never values)", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.repositoryCasesFindFirst.mockResolvedValue({
      id: 10,
      projectId: 1,
      name: "Login case",
    });
    mocks.dataSetFindFirst.mockResolvedValue({
      id: 7,
      projectId: 1,
      isShared: true,
      name: "Credentials dataset",
    });
    mocks.dataSetVersionFindFirst.mockResolvedValue({
      id: 50,
      dataSetId: 7,
      parametersJson: [{ name: "email" }, { name: "password" }],
      rowsJson: [],
    });
    mocks.testCaseParameterFindMany.mockResolvedValue([
      { name: "email", required: true },
      { name: "password", required: true },
    ]);
    mocks.txAssignmentUpsert.mockResolvedValue({
      id: 99,
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      mappingJson: { email: "email", password: "password" },
    });

    const [req, ctx] = buildPut("10", {
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      mappingJson: { email: "email", password: "password" },
    });
    await PUT(req, ctx);

    expect(mocks.captureAuditEvent).toHaveBeenCalledTimes(1);
    const event = mocks.captureAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({
      action: "UPDATE",
      entityType: "CaseSharedDataSetAssignment",
      entityName: "Login case → Credentials dataset",
      projectId: 1,
      userId: "user-1",
      metadata: {
        caseId: 10,
        sharedDataSetId: 7,
        pinnedVersionId: 50,
        // KEYS only — column names. Parameter names (the values) MUST NOT
        // appear in the audit metadata.
        mappingColumns: ["email", "password"],
      },
    });
  });
});

describe("DELETE /api/repository/cases/[caseId]/shared-dataset", () => {
  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildDelete("1");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 404 when no assignment exists for the case", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.assignmentFindUnique.mockResolvedValue(null);

    const [req, ctx] = buildDelete("10");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(404);
  });

  it("hard-deletes the assignment and emits an audit event", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.assignmentFindUnique.mockResolvedValue({
      id: 99,
      sharedDataSetId: 7,
      pinnedVersionId: 50,
      case: { projectId: 1, name: "Login case" },
      sharedDataSet: { name: "Credentials dataset" },
    });

    const [req, ctx] = buildDelete("10");
    const res = await DELETE(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(mocks.txAssignmentDelete).toHaveBeenCalledWith({
      where: { caseId: 10 },
    });
    expect(mocks.captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.captureAuditEvent.mock.calls[0][0]).toMatchObject({
      action: "DELETE",
      entityType: "CaseSharedDataSetAssignment",
      entityId: "99",
      entityName: "Login case → Credentials dataset",
      projectId: 1,
      userId: "user-1",
      metadata: {
        caseId: 10,
        sharedDataSetId: 7,
        pinnedVersionId: 50,
      },
    });
  });
});
