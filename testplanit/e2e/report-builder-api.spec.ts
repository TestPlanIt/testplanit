/**
 * E2E tests for Report Builder API endpoints
 *
 * Tests all report generation endpoints to ensure they return valid data
 * before drill-down tests can proceed.
 */

import { test } from "./helpers/api-test-base";
import { expect } from "@playwright/test";

test.describe("Report Builder API @api @reports @admin", () => {
  const TEST_PROJECT_ID = 331;

  test.describe("Test Execution Reports", () => {
    test("should generate test execution report with user dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["testResults"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data).toHaveProperty("results");
      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate test execution report with date dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["date"],
          metrics: ["testResults", "passRate"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate test execution report with status dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["status"],
          metrics: ["testResults"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate test execution report with configuration dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["configuration"],
          metrics: ["testResults"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate test execution report with multiple dimensions", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user", "date"],
          metrics: ["testResults", "passRate"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate test execution report with date range filter", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["date"],
          metrics: ["testResults"],
          startDate: "2024-01-01T00:00:00.000Z",
          endDate: "2026-12-31T23:59:59.999Z",
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });
  });

  test.describe("User Engagement Reports", () => {
    test("should generate user engagement report with user dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/user-engagement", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["executionCount", "createdCaseCount"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate user engagement report with date dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/user-engagement", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["date"],
          metrics: ["executionCount"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });
  });

  test.describe("Repository Stats Reports", () => {
    test("should generate repository stats report", async ({ request }) => {
      const response = await request.post("/api/report-builder/repository-stats", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["folder"],
          metrics: ["testCaseCount"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data.results).toBeInstanceOf(Array);
    });
  });

  test.describe("Session Analysis Reports", () => {
    test("should generate session analysis report with creator dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/session-analysis", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: ["sessionCount", "averageDuration"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate session analysis report with date dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/session-analysis", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["date"],
          metrics: ["sessionCount"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });
  });

  test.describe("Issue Tracking Reports", () => {
    test("should generate issue tracking report with creator dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/issue-tracking", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["creator"],
          metrics: ["issueCount"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate issue tracking report with date dimension", async ({ request }) => {
      const response = await request.post("/api/report-builder/issue-tracking", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["date"],
          metrics: ["issueCount"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });
  });

  test.describe("Cross-Project Reports", () => {
    test("should generate cross-project test execution report", async ({ request }) => {
      const response = await request.post("/api/report-builder/cross-project-test-execution", {
        data: {
          projectIds: [TEST_PROJECT_ID],
          dimensions: ["project", "user"],
          metrics: ["testResults"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      expect(data.results).toBeInstanceOf(Array);
    });

    test("should generate cross-project user engagement report", async ({ request }) => {
      const response = await request.post("/api/report-builder/cross-project-user-engagement", {
        data: {
          projectIds: [TEST_PROJECT_ID],
          dimensions: ["project"],
          metrics: ["executionCount"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      expect(data.results).toBeInstanceOf(Array);
    });
  });

  test.describe("Error Handling", () => {
    test("should return 400 for missing projectId", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          dimensions: ["user"],
          metrics: ["testResults"],
        },
      });

      expect(response.status()).toBe(400);
    });

    test("should return 400 for invalid dimensions", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["invalid_dimension"],
          metrics: ["testResults"],
        },
      });

      expect(response.status()).toBe(400);
    });

    test("should return 400 for invalid metrics", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["invalid_metric"],
        },
      });

      expect(response.status()).toBe(400);
    });

    test("should return 400 for empty dimensions array", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: [],
          metrics: ["testResults"],
        },
      });

      expect(response.status()).toBe(400);
    });

    test("should return 400 for empty metrics array", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: [],
        },
      });

      expect(response.status()).toBe(400);
    });
  });

  test.describe("Response Structure Validation", () => {
    test("should return properly structured response", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["testResults"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      // Validate response structure
      expect(data).toHaveProperty("results");
      expect(data.results).toBeInstanceOf(Array);

      // Validate results array structure
      if (data.results.length > 0) {
        const firstResult = data.results[0];

        // Should have dimension values
        expect(firstResult).toHaveProperty("user");

        // Should have metric values (metric name format varies)
        const metricKeys = Object.keys(firstResult).filter(
          (key) => !["user", "date", "status", "configuration", "milestone", "project"].includes(key)
        );
        expect(metricKeys.length).toBeGreaterThan(0);
      }
    });

    test("should return correct dimension objects with id and name", async ({ request }) => {
      const response = await request.post("/api/report-builder/test-execution", {
        data: {
          projectId: TEST_PROJECT_ID,
          dimensions: ["user"],
          metrics: ["testResults"],
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();

      if (data.results.length > 0) {
        const firstResult = data.results[0];

        // Dimension values should be objects with id and name
        if (firstResult.user) {
          expect(firstResult.user).toHaveProperty("id");
          expect(firstResult.user).toHaveProperty("name");
        }
      }
    });
  });
});
