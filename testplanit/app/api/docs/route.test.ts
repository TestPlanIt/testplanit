import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetApiCategories, mockLoadSpecByCategory, mockApiCategories } = vi.hoisted(() => ({
  mockGetApiCategories: vi.fn(),
  mockLoadSpecByCategory: vi.fn(),
  mockApiCategories: {
    custom: { title: "Custom API Endpoints", description: "...", tags: [] },
    projects: { title: "Projects & Folders", description: "...", tags: [] },
    testCases: { title: "Test Cases & Repository", description: "...", tags: [] },
  },
}));

vi.mock("~/lib/openapi/merge-specs", () => ({
  get API_CATEGORIES() {
    return mockApiCategories;
  },
  getApiCategories: mockGetApiCategories,
  loadSpecByCategory: mockLoadSpecByCategory,
}));

import { GET } from "./route";

function createRequest(searchParams: Record<string, string>): NextRequest {
  const url = new URL("http://localhost/api/docs");
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }
  return { url: url.toString() } as unknown as NextRequest;
}

const mockCategoryList = [
  { id: "custom", title: "Custom API Endpoints" },
  { id: "projects", title: "Projects & Folders" },
  { id: "testCases", title: "Test Cases & Repository" },
];

const mockSpec = {
  openapi: "3.0.0",
  info: { title: "Custom API", version: "1.0.0" },
  paths: {},
};

describe("GET /api/docs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetApiCategories.mockReturnValue(mockCategoryList);
    mockLoadSpecByCategory.mockReturnValue(mockSpec);
  });

  describe("?list=true", () => {
    it("returns list of categories when list=true", async () => {
      const request = createRequest({ list: "true" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.categories).toEqual(mockCategoryList);
      expect(mockGetApiCategories).toHaveBeenCalledOnce();
    });

    it("does not call loadSpecByCategory when listing categories", async () => {
      const request = createRequest({ list: "true" });
      await GET(request);

      expect(mockLoadSpecByCategory).not.toHaveBeenCalled();
    });
  });

  describe("?category=...", () => {
    it("returns specific OpenAPI spec for valid category", async () => {
      const request = createRequest({ category: "custom" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.openapi).toBe("3.0.0");
      expect(mockLoadSpecByCategory).toHaveBeenCalledWith("custom");
    });

    it("returns 400 for invalid category", async () => {
      const request = createRequest({ category: "invalid-category" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid category");
      expect(data.availableCategories).toEqual(["custom", "projects", "testCases"]);
    });

    it("returns 400 with available categories listed for unknown category", async () => {
      const request = createRequest({ category: "nonexistent" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.availableCategories).toBeDefined();
    });
  });

  describe("No params (default)", () => {
    it("returns usage instructions and categories list when no params given", async () => {
      const request = createRequest({});
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.message).toBeDefined();
      expect(data.categories).toEqual(mockCategoryList);
      expect(data.usage).toBeDefined();
    });

    it("includes usage hints with example URLs", async () => {
      const request = createRequest({});
      const response = await GET(request);
      const data = await response.json();

      expect(data.usage.listCategories).toBeDefined();
      expect(data.usage.viewCategory).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("returns 500 when loadSpecByCategory throws", async () => {
      mockLoadSpecByCategory.mockImplementation(() => {
        throw new Error("File not found");
      });

      const request = createRequest({ category: "custom" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to load OpenAPI specification");
    });

    it("returns 500 when getApiCategories throws", async () => {
      mockGetApiCategories.mockImplementation(() => {
        throw new Error("Read error");
      });

      const request = createRequest({ list: "true" });
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to load OpenAPI specification");
    });
  });
});
