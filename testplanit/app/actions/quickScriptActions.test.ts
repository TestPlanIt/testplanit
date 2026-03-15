import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetServerAuthSession, mockPrisma, mockExtractTextFromNode } =
  vi.hoisted(() => ({
    mockGetServerAuthSession: vi.fn(),
    mockPrisma: {
      repositoryCases: {
        findMany: vi.fn(),
      },
    },
    mockExtractTextFromNode: vi.fn((node: any) =>
      typeof node === "string" ? node : ""
    ),
  }));

vi.mock("~/server/auth", () => ({
  getServerAuthSession: mockGetServerAuthSession,
}));

vi.mock("~/lib/prisma", () => ({
  prisma: mockPrisma,
}));

vi.mock("~/utils/extractTextFromJson", () => ({
  extractTextFromNode: mockExtractTextFromNode,
}));

import { fetchCasesForQuickScript } from "./quickScriptActions";

function makeMockCase(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: "Login Test",
    folder: { name: "Auth" },
    state: { name: "Ready" },
    estimate: 300,
    automated: false,
    creator: { name: "Jane Doe", email: "jane@example.com" },
    createdAt: new Date("2025-06-15T12:00:00Z"),
    tags: [{ name: "smoke" }, { name: "auth" }],
    steps: [
      { order: 0, step: "Go to login", expectedResult: "Login page shown" },
      {
        order: 1,
        step: "Enter credentials",
        expectedResult: "Fields filled",
      },
    ],
    caseFieldValues: [],
    ...overrides,
  };
}

describe("fetchCasesForQuickScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-1" },
    });
    mockPrisma.repositoryCases.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("authentication", () => {
    it("should return error when session is null", async () => {
      mockGetServerAuthSession.mockResolvedValue(null);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result).toEqual({
        success: false,
        error: "Unauthorized",
        data: [],
      });
    });

    it("should return error when session has no user", async () => {
      mockGetServerAuthSession.mockResolvedValue({ user: null });

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result).toEqual({
        success: false,
        error: "Unauthorized",
        data: [],
      });
    });
  });

  describe("data transformation", () => {
    it("should map basic case fields correctly", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([makeMockCase()]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);

      const c = result.data[0];
      expect(c.name).toBe("Login Test");
      expect(c.id).toBe(1);
      expect(c.folder).toBe("Auth");
      expect(c.state).toBe("Ready");
      expect(c.estimate).toBe(300);
      expect(c.automated).toBe(false);
    });

    it("should return empty string when folder is null", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({ folder: null }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].folder).toBe("");
    });

    it("should return empty string when state is null", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({ state: null }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].state).toBe("");
    });

    it("should format createdAt as yyyy-MM-dd", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([makeMockCase()]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].createdAt).toBe("2025-06-15");
    });

    it("should use creator name when available", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([makeMockCase()]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].createdBy).toBe("Jane Doe");
    });

    it("should fall back to creator email when name is missing", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({ creator: { name: null, email: "jane@example.com" } }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].createdBy).toBe("jane@example.com");
    });

    it("should return empty string when creator is null", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({ creator: null }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].createdBy).toBe("");
    });

    it("should join tag names with comma separator", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([makeMockCase()]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].tags).toBe("smoke, auth");
    });

    it("should return empty string when tags is empty", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({ tags: [] }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].tags).toBe("");
    });

    it("should increment step order by 1 (0-indexed to 1-indexed)", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([makeMockCase()]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].steps[0].order).toBe(1);
      expect(result.data[0].steps[1].order).toBe(2);
    });

    it("should call extractTextFromNode on step fields", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([makeMockCase()]);

      await fetchCasesForQuickScript({ caseIds: [1], projectId: 1 });

      expect(mockExtractTextFromNode).toHaveBeenCalledWith("Go to login");
      expect(mockExtractTextFromNode).toHaveBeenCalledWith(
        "Login page shown"
      );
      expect(mockExtractTextFromNode).toHaveBeenCalledWith(
        "Enter credentials"
      );
      expect(mockExtractTextFromNode).toHaveBeenCalledWith("Fields filled");
    });
  });

  describe("custom field value transformation", () => {
    function makeFieldValue(
      fieldType: string,
      value: any,
      opts: { systemName?: string; fieldOptions?: any[] } = {}
    ) {
      return {
        value,
        field: {
          systemName: opts.systemName || "testField",
          type: { type: fieldType },
          fieldOptions: opts.fieldOptions || [],
        },
      };
    }

    it("should map Dropdown value to option name", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Dropdown", 10, {
              systemName: "priority",
              fieldOptions: [
                { fieldOption: { id: 10, name: "High" } },
                { fieldOption: { id: 20, name: "Low" } },
              ],
            }),
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].fields.priority).toBe("High");
    });

    it("should map Multi Select array to comma-separated names", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Multi Select", [10, 20], {
              systemName: "components",
              fieldOptions: [
                { fieldOption: { id: 10, name: "Frontend" } },
                { fieldOption: { id: 20, name: "Backend" } },
              ],
            }),
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].fields.components).toBe("Frontend, Backend");
    });

    it("should convert Checkbox true to 'Yes'", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Checkbox", true, { systemName: "isActive" }),
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].fields.isActive).toBe("Yes");
    });

    it("should convert Checkbox false to 'No'", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Checkbox", false, { systemName: "isActive" }),
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].fields.isActive).toBe("No");
    });

    it("should format Date field as yyyy-MM-dd", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Date", "2025-03-15T12:00:00Z", {
              systemName: "dueDate",
            }),
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].fields.dueDate).toBe("2025-03-15");
    });

    it("should call extractTextFromNode for Text Long fields", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Text Long", "some rich text", {
              systemName: "description",
            }),
          ],
        }),
      ]);

      await fetchCasesForQuickScript({ caseIds: [1], projectId: 1 });

      expect(mockExtractTextFromNode).toHaveBeenCalledWith("some rich text");
    });

    it("should convert other types to string", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Integer", 42, { systemName: "retryCount" }),
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].fields.retryCount).toBe("42");
    });

    it("should return empty string for null value", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            makeFieldValue("Text Long", null, { systemName: "notes" }),
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result.data[0].fields.notes).toBe("");
    });

    it("should skip fields with no systemName", async () => {
      mockPrisma.repositoryCases.findMany.mockResolvedValue([
        makeMockCase({
          caseFieldValues: [
            {
              value: "test",
              field: { systemName: null, type: { type: "Text" } },
            },
          ],
        }),
      ]);

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(Object.keys(result.data[0].fields)).toHaveLength(0);
    });
  });

  describe("error handling", () => {
    it("should return error when prisma throws", async () => {
      mockPrisma.repositoryCases.findMany.mockRejectedValue(
        new Error("DB error")
      );

      const result = await fetchCasesForQuickScript({
        caseIds: [1],
        projectId: 1,
      });

      expect(result).toEqual({
        success: false,
        error: "Failed to fetch cases",
        data: [],
      });
    });
  });
});
