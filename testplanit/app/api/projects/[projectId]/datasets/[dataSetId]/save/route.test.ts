import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

// Hoisted mocks (vi.mock factories run before the file's top-level
// statements, so all mock fns must be created inside vi.hoisted).
const mocks = vi.hoisted(() => ({
  dataSetFindFirst: vi.fn(),
  txDataSetVersionAggregate: vi.fn(),
  txDataSetVersionCreate: vi.fn(),
  txDataSetUpdate: vi.fn(),
  txDataSetRowFindMany: vi.fn(),
  txDataSetRowUpdateMany: vi.fn(),
  txDataSetRowCreate: vi.fn(),
  captureAuditEvent: vi.fn(async () => undefined) as unknown as ReturnType<
    typeof vi.fn<(...args: any[]) => Promise<void>>
  >,
}));

vi.mock("~/lib/auth/utils", () => ({
  getEnhancedDb: vi.fn(async () => ({
    dataSet: { findFirst: mocks.dataSetFindFirst },
    $transaction: async (cb: any) =>
      cb({
        dataSetVersion: {
          aggregate: mocks.txDataSetVersionAggregate,
          create: mocks.txDataSetVersionCreate,
        },
        dataSet: { update: mocks.txDataSetUpdate },
        dataSetRow: {
          findMany: mocks.txDataSetRowFindMany,
          updateMany: mocks.txDataSetRowUpdateMany,
          create: mocks.txDataSetRowCreate,
        },
      }),
  })),
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: (...args: any[]) => mocks.captureAuditEvent(...args),
}));

import { getServerSession } from "next-auth";

import { POST } from "./route";

const session = { user: { id: "user-1", name: "Tester" } };

const buildPost = (
  projectId: string,
  dataSetId: string,
  body: unknown
): [
  NextRequest,
  { params: Promise<{ projectId: string; dataSetId: string }> },
] => {
  const url = `http://localhost/api/projects/${projectId}/datasets/${dataSetId}/save`;
  const req = new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return [req, { params: Promise.resolve({ projectId, dataSetId }) }];
};

const sharedDataset = (
  overrides: Partial<{ id: number; isShared: boolean }> = {}
) => ({
  id: overrides.id ?? 7,
  isShared: overrides.isShared ?? true,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/projects/[projectId]/datasets/[dataSetId]/save", () => {
  it("returns 401 when unauthenticated", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const [req, ctx] = buildPost("1", "7", { rowsJson: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 400 for non-numeric path params", async () => {
    (getServerSession as any).mockResolvedValue(session);
    const [req, ctx] = buildPost("x", "y", { rowsJson: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the dataset is not found in the project", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(null);
    const [req, ctx] = buildPost("1", "7", { rowsJson: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 422 when the target dataset is an owner dataset (isShared=false)", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(
      sharedDataset({ isShared: false })
    );
    const [req, ctx] = buildPost("1", "7", { rowsJson: [] });
    const res = await POST(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/owner datasets are not versioned/i);
  });

  it("returns 422 when the payload exceeds the 5000-row cap", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(sharedDataset());

    const tooMany = Array.from({ length: 6000 }, (_, i) => ({
      label: `row-${i}`,
      valuesJson: { email: `u${i}@x` },
    }));
    const [req, ctx] = buildPost("1", "7", { rowsJson: tooMany });
    const res = await POST(req, ctx);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Validation failed");
  });

  it("first save (lazy v1 backfill) writes v1 baseline + v2 post-edit and bumps DataSet.version to 2", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(sharedDataset());
    // No prior versions → triggers lazy backfill.
    mocks.txDataSetVersionAggregate.mockResolvedValue({
      _max: { version: null },
    });
    // Two pre-existing live rows the backfill captures into v1.
    mocks.txDataSetRowFindMany.mockResolvedValue([
      {
        label: "alice",
        valuesJson: { email: "alice@x", password: "pa" },
      },
      {
        label: "bob",
        valuesJson: { email: "bob@x", password: "pb" },
      },
    ]);
    mocks.txDataSetVersionCreate
      // v1 (baseline)
      .mockResolvedValueOnce({ id: 100, version: 1, rowCount: 2 })
      // v2 (post-edit)
      .mockResolvedValueOnce({ id: 101, version: 2, rowCount: 1 });

    const [req, ctx] = buildPost("1", "7", {
      rowsJson: [{ valuesJson: { email: "carol@x", password: "pc" } }],
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.version).toBe(2);
    expect(json.rowCount).toBe(1);

    // Two version creates: v1 baseline first, then v2 post-edit.
    expect(mocks.txDataSetVersionCreate).toHaveBeenCalledTimes(2);
    const v1Args = mocks.txDataSetVersionCreate.mock.calls[0][0];
    const v2Args = mocks.txDataSetVersionCreate.mock.calls[1][0];
    expect(v1Args.data.version).toBe(1);
    expect(v1Args.data.rowCount).toBe(2);
    expect(v2Args.data.version).toBe(2);
    expect(v2Args.data.rowCount).toBe(1);

    // W5 lock: v1 parametersJson is non-null AND derived from live row column names.
    expect(v1Args.data.parametersJson).not.toBeNull();
    expect(Array.isArray(v1Args.data.parametersJson)).toBe(true);
    expect(v1Args.data.parametersJson.map((p: any) => p.name).sort()).toEqual([
      "email",
      "password",
    ]);
    // Each derived parameter is { name, type: "STRING", order, required: false }
    for (const p of v1Args.data.parametersJson) {
      expect(p.type).toBe("STRING");
      expect(p.required).toBe(false);
      expect(typeof p.order).toBe("number");
    }

    // DataSet pointer bumps to 2.
    expect(mocks.txDataSetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { version: 2 },
    });

    // Live rows soft-deleted then recreated (NEVER deleteMany).
    expect(mocks.txDataSetRowUpdateMany).toHaveBeenCalledWith({
      where: { dataSetId: 7, isDeleted: false },
      data: { isDeleted: true },
    });
    expect(mocks.txDataSetRowCreate).toHaveBeenCalledTimes(1);
  });

  it("first save with EMPTY pre-edit dataset still backfills v1 with empty parametersJson (NOT null)", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(sharedDataset());
    mocks.txDataSetVersionAggregate.mockResolvedValue({
      _max: { version: null },
    });
    mocks.txDataSetRowFindMany.mockResolvedValue([]); // empty pre-edit
    mocks.txDataSetVersionCreate
      .mockResolvedValueOnce({ id: 100, version: 1, rowCount: 0 })
      .mockResolvedValueOnce({ id: 101, version: 2, rowCount: 1 });

    const [req, ctx] = buildPost("1", "7", {
      rowsJson: [{ valuesJson: { email: "carol@x" } }],
    });
    await POST(req, ctx);

    const v1Args = mocks.txDataSetVersionCreate.mock.calls[0][0];
    // W5 lock: empty pre-edit → empty parametersJson array, NEVER null.
    expect(v1Args.data.parametersJson).not.toBeNull();
    expect(Array.isArray(v1Args.data.parametersJson)).toBe(true);
    expect(v1Args.data.parametersJson).toEqual([]);
  });

  it("subsequent save (existing v3) writes v4 and bumps pointer to 4", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(sharedDataset());
    mocks.txDataSetVersionAggregate.mockResolvedValue({ _max: { version: 3 } });
    mocks.txDataSetVersionCreate.mockResolvedValueOnce({
      id: 200,
      version: 4,
      rowCount: 2,
    });

    const [req, ctx] = buildPost("1", "7", {
      rowsJson: [
        { valuesJson: { email: "a@x" } },
        { valuesJson: { email: "b@x" } },
      ],
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.version).toBe(4);

    // Only one version create — no v1 backfill on a versioned dataset.
    expect(mocks.txDataSetVersionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.txDataSetVersionCreate.mock.calls[0][0].data.version).toBe(4);

    // No backfill row read.
    expect(mocks.txDataSetRowFindMany).not.toHaveBeenCalled();

    // DataSet pointer bumped to 4.
    expect(mocks.txDataSetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { version: 4 },
    });
  });

  it("save with branchedFromVersionId=2 while DataSet.version=5 still writes v6 (NOT v3)", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(sharedDataset());
    // Current max is 5 (the parent dataset version).
    mocks.txDataSetVersionAggregate.mockResolvedValue({ _max: { version: 5 } });
    mocks.txDataSetVersionCreate.mockResolvedValueOnce({
      id: 300,
      version: 6,
      rowCount: 1,
    });

    const [req, ctx] = buildPost("1", "7", {
      branchedFromVersionId: 2,
      rowsJson: [{ valuesJson: { email: "x@x" } }],
    });
    const res = await POST(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Branched-from is captured in the audit metadata only; the new
    // version is currentMax+1, not branch+1.
    expect(json.version).toBe(6);
    expect(mocks.txDataSetVersionCreate.mock.calls[0][0].data.version).toBe(6);
    expect(mocks.txDataSetUpdate).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { version: 6 },
    });
  });

  it("emits an audit event with newVersion + branchedFromVersionId in metadata", async () => {
    (getServerSession as any).mockResolvedValue(session);
    mocks.dataSetFindFirst.mockResolvedValue(sharedDataset());
    mocks.txDataSetVersionAggregate.mockResolvedValue({ _max: { version: 5 } });
    mocks.txDataSetVersionCreate.mockResolvedValueOnce({
      id: 300,
      version: 6,
      rowCount: 0,
    });

    const [req, ctx] = buildPost("1", "7", {
      branchedFromVersionId: 2,
      rowsJson: [],
    });
    await POST(req, ctx);

    expect(mocks.captureAuditEvent).toHaveBeenCalledTimes(1);
    const event = mocks.captureAuditEvent.mock.calls[0][0];
    expect(event).toMatchObject({
      action: "UPDATE",
      entityType: "DataSet",
      entityId: "7",
      projectId: 1,
      userId: "user-1",
      metadata: {
        newVersion: 6,
        branchedFromVersionId: 2,
        backfilledV1: false,
      },
    });
  });
});
