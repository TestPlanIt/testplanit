import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies
const mockFindMany = vi.fn();

vi.mock("~/lib/db", () => ({
  baseDb: {
    repositoryCases: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}));

const mockGetServerAuthSession = vi.fn();
vi.mock("~/server/auth", () => ({
  getServerAuthSession: () => mockGetServerAuthSession(),
}));

import { fetchAllCasesForExport } from "./exportActions";

describe("exportActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerAuthSession.mockResolvedValue({
      user: { id: "user-123" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchAllCasesForExport", () => {
    const baseArgs = {
      orderBy: { name: "asc" as const },
      where: { projectId: 1, isDeleted: false },
    };

    describe("authentication", () => {
      it("should return error when not authenticated", async () => {
        mockGetServerAuthSession.mockResolvedValue(null);

        const result = await fetchAllCasesForExport(baseArgs);

        expect(result).toEqual({
          success: false,
          error: "User not authenticated",
          data: [],
        });
      });

      it("should return error when user has no id", async () => {
        mockGetServerAuthSession.mockResolvedValue({ user: {} });

        const result = await fetchAllCasesForExport(baseArgs);

        expect(result).toEqual({
          success: false,
          error: "User not authenticated",
          data: [],
        });
      });
    });

    describe("allFiltered scope", () => {
      it("should use provided where clause for filtered scope", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Test Case 1",
            linksFrom: [],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allFiltered",
        });

        expect(result.success).toBe(true);
        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: baseArgs.where,
          })
        );
      });

      it("should use provided where clause when scope is undefined", async () => {
        mockFindMany.mockResolvedValue([]);

        await fetchAllCasesForExport(baseArgs);

        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: baseArgs.where,
          })
        );
      });
    });

    describe("allProject scope", () => {
      it("should return error when projectId is not provided for allProject scope", async () => {
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allProject",
          // No projectId
        });

        expect(result).toEqual({
          success: false,
          error: "projectId is required",
          data: [],
        });

        consoleSpy.mockRestore();
      });

      it("should override where clause for allProject scope", async () => {
        mockFindMany.mockResolvedValue([]);

        await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allProject",
          projectId: 42,
        });

        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              projectId: 42,
              isDeleted: false,
              isArchived: false,
            },
          })
        );
      });
    });

    describe("successful queries", () => {
      it("should return cases with linkedCases field", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Test Case 1",
            linksFrom: [
              {
                isDeleted: false,
                caseB: { name: "Linked Case A", isDeleted: false },
              },
            ],
            linksTo: [
              {
                isDeleted: false,
                caseA: { name: "Linked Case B", isDeleted: false },
              },
            ],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport(baseArgs);

        expect(result.success).toBe(true);
        expect((result.data[0] as any).linkedCases).toBe(
          "Linked Case A, Linked Case B"
        );
      });

      it("should filter out deleted links", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Test Case 1",
            linksFrom: [
              {
                isDeleted: true,
                caseB: { name: "Deleted Link", isDeleted: false },
              },
              {
                isDeleted: false,
                caseB: { name: "Active Link", isDeleted: false },
              },
            ],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport(baseArgs);

        expect((result.data[0] as any).linkedCases).toBe("Active Link");
      });

      it("should filter out links to deleted cases", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Test Case 1",
            linksFrom: [
              {
                isDeleted: false,
                caseB: { name: "Deleted Case", isDeleted: true },
              },
            ],
            linksTo: [
              {
                isDeleted: false,
                caseA: { name: "Active Case", isDeleted: false },
              },
            ],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport(baseArgs);

        expect((result.data[0] as any).linkedCases).toBe("Active Case");
      });

      it("should deduplicate linked case names", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Test Case 1",
            linksFrom: [
              {
                isDeleted: false,
                caseB: { name: "Same Name", isDeleted: false },
              },
            ],
            linksTo: [
              {
                isDeleted: false,
                caseA: { name: "Same Name", isDeleted: false },
              },
            ],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport(baseArgs);

        expect((result.data[0] as any).linkedCases).toBe("Same Name");
      });

      it("should return empty linkedCases for cases with no links", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Test Case 1",
            linksFrom: [],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport(baseArgs);

        expect((result.data[0] as any).linkedCases).toBe("");
      });

      it("should handle null linksFrom/linksTo", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Test Case 1",
            linksFrom: null,
            linksTo: null,
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport(baseArgs);

        expect((result.data[0] as any).linkedCases).toBe("");
      });

      it("should use provided orderBy", async () => {
        mockFindMany.mockResolvedValue([]);

        await fetchAllCasesForExport({
          orderBy: { createdAt: "desc" },
          where: { projectId: 1 },
        });

        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: { createdAt: "desc" },
          })
        );
      });
    });

    describe("postFetchFilters", () => {
      const textFilter = {
        fieldId: 10,
        type: "text" as const,
        operator: "contains",
        value1: "hello",
      };

      it("should apply text filters to the exported row set", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Matching",
            caseFieldValues: [{ fieldId: 10, value: "hello world" }],
            linksFrom: [],
            linksTo: [],
          },
          {
            id: 2,
            name: "Not matching",
            caseFieldValues: [{ fieldId: 10, value: "goodbye" }],
            linksFrom: [],
            linksTo: [],
          },
          {
            id: 3,
            name: "No value",
            caseFieldValues: [],
            linksFrom: [],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allFiltered",
          postFetchFilters: [textFilter],
        });

        expect(result.success).toBe(true);
        expect(result.data.map((c: any) => c.id)).toEqual([1]);
      });

      it("should apply steps filters against pre-expansion step rows", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Two steps",
            steps: [
              { id: 1, sharedStepGroupId: null },
              { id: 2, sharedStepGroupId: null },
            ],
            linksFrom: [],
            linksTo: [],
          },
          {
            id: 2,
            name: "One step",
            steps: [{ id: 3, sharedStepGroupId: null }],
            linksFrom: [],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allFiltered",
          postFetchFilters: [
            { fieldId: 30, type: "steps", operator: "gte", value1: 2 },
          ],
        });

        expect(result.data.map((c: any) => c.id)).toEqual([1]);
      });

      it("should not let orphaned field values satisfy a filter", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Orphaned value",
            template: { caseFields: [{ caseField: { id: 99 } }] },
            caseFieldValues: [{ fieldId: 10, value: "hello world" }],
            linksFrom: [],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allFiltered",
          postFetchFilters: [textFilter],
        });

        expect(result.data).toEqual([]);
      });

      it("should keep exported row content unfiltered (only the row set shrinks)", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Matching",
            template: { caseFields: [{ caseField: { id: 10 } }] },
            caseFieldValues: [
              { fieldId: 10, value: "hello world" },
              { fieldId: 99, value: "orphaned but exported" },
            ],
            linksFrom: [],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allFiltered",
          postFetchFilters: [textFilter],
        });

        expect((result.data[0] as any).caseFieldValues).toHaveLength(2);
      });

      it("should ignore filters for allProject scope", async () => {
        const mockCases = [
          {
            id: 1,
            name: "Not matching",
            caseFieldValues: [{ fieldId: 10, value: "goodbye" }],
            linksFrom: [],
            linksTo: [],
          },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allProject",
          projectId: 42,
          postFetchFilters: [textFilter],
        });

        expect(result.data.map((c: any) => c.id)).toEqual([1]);
      });

      it("should export all rows when no filters are provided", async () => {
        const mockCases = [
          { id: 1, name: "A", linksFrom: [], linksTo: [] },
          { id: 2, name: "B", linksFrom: [], linksTo: [] },
        ];
        mockFindMany.mockResolvedValue(mockCases);

        const result = await fetchAllCasesForExport({
          ...baseArgs,
          scope: "allFiltered",
        });

        expect(result.data.map((c: any) => c.id)).toEqual([1, 2]);
      });
    });

    describe("error handling", () => {
      it("should return error on database failure", async () => {
        mockFindMany.mockRejectedValue(new Error("DB error"));
        const consoleSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const result = await fetchAllCasesForExport(baseArgs);

        expect(result).toEqual({
          success: false,
          error: "Failed to fetch cases for export",
          data: [],
        });

        consoleSpy.mockRestore();
      });
    });

    describe("select clause", () => {
      it("should include required fields in select", async () => {
        mockFindMany.mockResolvedValue([]);

        await fetchAllCasesForExport(baseArgs);

        expect(mockFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            select: expect.objectContaining({
              id: true,
              name: true,
              projectId: true,
              source: true,
              steps: expect.any(Object),
              caseTags: expect.any(Object),
              caseIssues: expect.any(Object),
              attachments: expect.any(Object),
              template: expect.any(Object),
              state: expect.any(Object),
              linksFrom: expect.any(Object),
              linksTo: expect.any(Object),
            }),
          })
        );
      });
    });
  });
});
