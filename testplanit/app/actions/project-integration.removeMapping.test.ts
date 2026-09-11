import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetServerAuthSession,
  mockFindUniqueMapping,
  mockTx,
  mockAuditedTransaction,
} = vi.hoisted(() => {
  const mockTx = {
    integrationProject: {
      findFirst: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn(),
    },
    projectIntegration: { update: vi.fn().mockResolvedValue({}) },
    webhookConfig: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  return {
    mockGetServerAuthSession: vi.fn(),
    mockFindUniqueMapping: vi.fn(),
    mockTx,
    mockAuditedTransaction: vi.fn(async (fn: (tx: typeof mockTx) => any) =>
      fn(mockTx)
    ),
  };
});

vi.mock("~/server/auth", () => ({
  getServerAuthSession: mockGetServerAuthSession,
}));
vi.mock("~/lib/auditContext", () => ({
  runWithAuditContext: (_ctx: unknown, fn: () => any) => fn(),
}));
vi.mock("~/lib/audit/auditedTransaction", () => ({
  auditedTransaction: mockAuditedTransaction,
}));
vi.mock("~/lib/db", () => ({
  baseDb: {
    integrationProject: { findFirst: mockFindUniqueMapping },
    projects: { findFirst: vi.fn() },
  },
}));

import { removeIntegrationProjectMapping } from "./project-integration";

const mapping = (isDefault: boolean) => ({
  id: "ip-1",
  isDefault,
  isActive: true,
  projectIntegration: { id: 5, projectId: 9 },
});

describe("removeIntegrationProjectMapping — default hand-over", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "admin", access: "ADMIN" },
    });
    mockTx.integrationProject.update.mockResolvedValue({});
    mockTx.integrationProject.count.mockResolvedValue(1);
  });

  it("promotes another active mapping before deactivating the default one", async () => {
    mockFindUniqueMapping.mockResolvedValue(mapping(true));
    mockTx.integrationProject.findFirst.mockResolvedValue({ id: "ip-2" });

    const result = await removeIntegrationProjectMapping("ip-1");

    expect(result.success).toBe(true);
    expect(mockTx.integrationProject.findFirst).toHaveBeenCalledWith({
      where: { projectIntegrationId: 5, isActive: true, id: { not: "ip-1" } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const calls = mockTx.integrationProject.update.mock.calls;
    expect(calls[0][0]).toEqual({
      where: { id: "ip-2" },
      data: { isDefault: true },
    });
    expect(calls[1][0]).toEqual({
      where: { id: "ip-1" },
      data: { isActive: false, isDefault: false },
    });
  });

  it("deactivates the last default mapping without promoting anything", async () => {
    mockFindUniqueMapping.mockResolvedValue(mapping(true));
    mockTx.integrationProject.findFirst.mockResolvedValue(null);
    mockTx.integrationProject.count.mockResolvedValue(0);

    const result = await removeIntegrationProjectMapping("ip-1");

    expect(result.success).toBe(true);
    expect(result.cascadedToParent).toBe(true);
    expect(mockTx.integrationProject.update).toHaveBeenCalledTimes(1);
    expect(mockTx.integrationProject.update.mock.calls[0][0]).toEqual({
      where: { id: "ip-1" },
      data: { isActive: false, isDefault: false },
    });
  });

  it("does not look for a successor when the removed mapping is not the default", async () => {
    mockFindUniqueMapping.mockResolvedValue(mapping(false));

    const result = await removeIntegrationProjectMapping("ip-1");

    expect(result.success).toBe(true);
    expect(mockTx.integrationProject.findFirst).not.toHaveBeenCalled();
    expect(mockTx.integrationProject.update).toHaveBeenCalledTimes(1);
  });
});
