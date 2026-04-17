import { getServerSession } from "next-auth";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auditBulkCreate } from "~/lib/services/auditLog";
import { POST } from "./route";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/services/auditLog", () => ({
  auditBulkCreate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/services/testCaseVersionService", () => ({
  createTestCaseVersionInTransaction: vi
    .fn()
    .mockResolvedValue({ id: 999, version: 1 }),
}));

vi.mock("~/utils/tiptapConversion", () => ({
  serializeTipTapJSON: vi.fn((x: unknown) =>
    JSON.stringify({ type: "doc", text: String(x) })
  ),
}));

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    repositoryFolders: { findFirst: vi.fn() },
    templates: { findFirst: vi.fn() },
    workflows: { findFirst: vi.fn() },
    repositoryCases: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    caseFieldValues: { create: vi.fn() },
    caseFieldVersionValues: { create: vi.fn() },
    steps: { create: vi.fn() },
    issue: { findFirst: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("POST /api/repository/import-generated-test-cases — audit emission", () => {
  const validSession = {
    user: {
      id: "user-1",
      email: "u@example.com",
      access: "ADMIN",
      name: "U",
    },
  };

  const buildRequest = (body: unknown): NextRequest =>
    new NextRequest(
      "http://localhost/api/repository/import-generated-test-cases",
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as any).mockResolvedValue(validSession);

    mockPrisma.repositoryFolders.findFirst.mockResolvedValue({
      id: 1,
      repositoryId: 1,
      project: { id: 10, isDeleted: false },
      repository: { id: 1 },
    });
    mockPrisma.templates.findFirst.mockResolvedValue({
      id: 1,
      caseFields: [],
    });
    mockPrisma.workflows.findFirst.mockResolvedValue({
      id: 1,
      name: "Open",
    });
    mockPrisma.repositoryCases.findFirst.mockResolvedValue({ order: 0 });
    mockPrisma.repositoryCases.create.mockImplementation(
      async (args: { data: { name: string } }) => ({
        id: Math.floor(Math.random() * 1_000_000),
        name: args.data.name,
        folderId: 1,
        currentVersion: 1,
      })
    );
    mockPrisma.repositoryCases.update.mockResolvedValue({ id: 1 });
  });

  it("emits auditBulkCreate once with RepositoryCases and count==imported.length when cases import successfully", async () => {
    const req = buildRequest({
      projectId: 10,
      folderId: 1,
      templateId: 1,
      testCases: [
        { id: "gen-1", name: "Test A", fieldValues: {}, automated: false },
        { id: "gen-2", name: "Test B", fieldValues: {}, automated: true },
      ],
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(auditBulkCreate).toHaveBeenCalledTimes(1);
    expect(auditBulkCreate).toHaveBeenCalledWith(
      "RepositoryCases",
      2,
      10,
      expect.objectContaining({
        source: "AI Generated Test Cases",
        templateId: 1,
        folderId: 1,
      })
    );
  });

  it("does NOT call auditBulkCreate when zero cases import successfully", async () => {
    // The route has per-case error tolerance — catching per-iteration errors
    // (route.ts lines 553-558) — so rejecting every create call results in
    // importedCases.length === 0, which means the audit block
    // (`if (importedCases.length > 0)`) is skipped.
    mockPrisma.repositoryCases.create.mockRejectedValue(
      new Error("boom — per-case failure")
    );

    const req = buildRequest({
      projectId: 10,
      folderId: 1,
      templateId: 1,
      testCases: [
        { id: "gen-1", name: "Test A", fieldValues: {}, automated: false },
      ],
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(auditBulkCreate).not.toHaveBeenCalled();
  });
});
