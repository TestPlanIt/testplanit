import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("~/server/auth", () => ({
  authOptions: {},
}));

vi.mock("~/lib/authContext", () => ({
  resolveViewerProjectScope: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  baseDb: {
    repositoryCases: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("~/lib/services/testRunCaseDetail", () => ({
  getTestRunCaseDetail: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { resolveViewerProjectScope } from "~/lib/authContext";
import { baseDb } from "~/lib/db";
import { getTestRunCaseDetail } from "~/lib/services/testRunCaseDetail";

import { GET } from "./route";

const createMockRequest = (params: Record<string, string>): Request => {
  const url = new URL("http://localhost/api/test-runs/case-detail");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return { nextUrl: url } as unknown as Request as any;
};

const mockSession = {
  user: { id: "user-1", name: "Test User", access: "USER" },
};

describe("Test Run Case Detail Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 when unauthenticated", async () => {
      (getServerSession as any).mockResolvedValue(null);

      const response = await GET(createMockRequest({ caseId: "1" }) as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Validation", () => {
    it("returns 400 when caseId is missing", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await GET(createMockRequest({}) as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("caseId is required");
    });

    it("returns 400 when caseId is not a number", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);

      const response = await GET(
        createMockRequest({ caseId: "not-a-number" }) as any
      );
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("caseId is required");
    });
  });

  describe("Not found", () => {
    it("returns { testcase: null } when the case doesn't exist, without checking scope", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.repositoryCases.findUnique as any).mockResolvedValue(null);

      const response = await GET(createMockRequest({ caseId: "999" }) as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.testcase).toBeNull();
      expect(resolveViewerProjectScope).not.toHaveBeenCalled();
      expect(getTestRunCaseDetail).not.toHaveBeenCalled();
    });
  });

  describe("Project access", () => {
    it("returns 403 when the viewer's scope excludes the case's project", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.repositoryCases.findUnique as any).mockResolvedValue({
        projectId: 5,
      });
      (resolveViewerProjectScope as any).mockResolvedValue([1, 2, 3]);

      const response = await GET(createMockRequest({ caseId: "42" }) as any);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Forbidden");
      expect(getTestRunCaseDetail).not.toHaveBeenCalled();
    });

    it("allows access when the viewer's scope includes the case's project", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.repositoryCases.findUnique as any).mockResolvedValue({
        projectId: 5,
      });
      (resolveViewerProjectScope as any).mockResolvedValue([5]);
      (getTestRunCaseDetail as any).mockResolvedValue({
        id: 42,
        name: "Some case",
      });

      const response = await GET(createMockRequest({ caseId: "42" }) as any);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.testcase).toEqual({ id: 42, name: "Some case" });
    });

    it("allows access unconditionally for ADMIN (null scope)", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.repositoryCases.findUnique as any).mockResolvedValue({
        projectId: 999,
      });
      (resolveViewerProjectScope as any).mockResolvedValue(null);
      (getTestRunCaseDetail as any).mockResolvedValue({ id: 42 });

      const response = await GET(createMockRequest({ caseId: "42" }) as any);

      expect(response.status).toBe(200);
      expect(getTestRunCaseDetail).toHaveBeenCalledWith(42, undefined);
    });
  });

  describe("testRunId passthrough", () => {
    it("passes a numeric testRunId through to getTestRunCaseDetail", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.repositoryCases.findUnique as any).mockResolvedValue({
        projectId: 5,
      });
      (resolveViewerProjectScope as any).mockResolvedValue([5]);
      (getTestRunCaseDetail as any).mockResolvedValue({ id: 42 });

      await GET(createMockRequest({ caseId: "42", testRunId: "10" }) as any);

      expect(getTestRunCaseDetail).toHaveBeenCalledWith(42, 10);
    });

    it("omits testRunId when not provided", async () => {
      (getServerSession as any).mockResolvedValue(mockSession);
      (baseDb.repositoryCases.findUnique as any).mockResolvedValue({
        projectId: 5,
      });
      (resolveViewerProjectScope as any).mockResolvedValue([5]);
      (getTestRunCaseDetail as any).mockResolvedValue({ id: 42 });

      await GET(createMockRequest({ caseId: "42" }) as any);

      expect(getTestRunCaseDetail).toHaveBeenCalledWith(42, undefined);
    });
  });
});
