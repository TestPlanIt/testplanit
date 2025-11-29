import { test, expect } from "./helpers/api-test-base";

test.describe("Date Sorting Across All Report APIs @api @reports", () => {
  // Test date sorting for User Engagement API
  test("User Engagement API should sort Activity Date chronologically", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: 331,
        dimensions: ["date"],
        metrics: ["executionCount"],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.executedAt);
        const currDate = new Date(data.results[i].date.executedAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }

      // Verify all dates are midnight UTC
      for (const result of data.results) {
        const date = new Date(result.date.executedAt);
        expect(date.getUTCHours()).toBe(0);
        expect(date.getUTCMinutes()).toBe(0);
        expect(date.getUTCSeconds()).toBe(0);
        expect(date.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  // Test date sorting for Test Execution API
  test("Test Execution API should sort Execution Date chronologically", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/test-execution", {
      data: {
        projectId: 331,
        dimensions: ["date"],
        metrics: ["testResults"],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.executedAt);
        const currDate = new Date(data.results[i].date.executedAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }

      // Verify all dates are midnight UTC
      for (const result of data.results) {
        const date = new Date(result.date.executedAt);
        expect(date.getUTCHours()).toBe(0);
        expect(date.getUTCMinutes()).toBe(0);
        expect(date.getUTCSeconds()).toBe(0);
        expect(date.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  // Test date sorting for Repository Stats API
  test("Repository Stats API should sort Creation Date chronologically", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/repository-stats",
      {
        data: {
          projectId: 331,
          dimensions: ["date"],
          metrics: ["testCaseCount"],
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.createdAt);
        const currDate = new Date(data.results[i].date.createdAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }

      // Verify all dates are midnight UTC
      for (const result of data.results) {
        const date = new Date(result.date.createdAt);
        expect(date.getUTCHours()).toBe(0);
        expect(date.getUTCMinutes()).toBe(0);
        expect(date.getUTCSeconds()).toBe(0);
        expect(date.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  // Test date sorting for Issue Tracking API
  test("Issue Tracking API should sort dates chronologically", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/issue-tracking", {
      data: {
        projectId: 331,
        dimensions: ["date"],
        metrics: ["issueCount"],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.createdAt);
        const currDate = new Date(data.results[i].date.createdAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }

      // Verify all dates are midnight UTC
      for (const result of data.results) {
        const date = new Date(result.date.createdAt);
        expect(date.getUTCHours()).toBe(0);
        expect(date.getUTCMinutes()).toBe(0);
        expect(date.getUTCSeconds()).toBe(0);
        expect(date.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  // Test date sorting for Session Analysis API
  test("Session Analysis API should sort Creation Date chronologically", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/session-analysis",
      {
        data: {
          projectId: 331,
          dimensions: ["date"],
          metrics: ["sessionCount"],
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.createdAt);
        const currDate = new Date(data.results[i].date.createdAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }

      // Verify all dates are midnight UTC
      for (const result of data.results) {
        const date = new Date(result.date.createdAt);
        expect(date.getUTCHours()).toBe(0);
        expect(date.getUTCMinutes()).toBe(0);
        expect(date.getUTCSeconds()).toBe(0);
        expect(date.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  // Test date sorting for Project Health API
  test("Project Health API should sort Activity Date chronologically", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/project-health", {
      data: {
        projectId: 331,
        dimensions: ["date"],
        metrics: ["totalMilestones"],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.createdAt);
        const currDate = new Date(data.results[i].date.createdAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }

      // Verify all dates are midnight UTC
      for (const result of data.results) {
        const date = new Date(result.date.createdAt);
        expect(date.getUTCHours()).toBe(0);
        expect(date.getUTCMinutes()).toBe(0);
        expect(date.getUTCSeconds()).toBe(0);
        expect(date.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  // Test date sorting for main report-builder API
  test("Main Report Builder API should sort Execution Date chronologically", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder", {
      data: {
        projectId: 331,
        dimensions: ["date"],
        metrics: ["testResultCount"],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.executedAt);
        const currDate = new Date(data.results[i].date.executedAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }

      // Verify all dates are midnight UTC
      for (const result of data.results) {
        const date = new Date(result.date.executedAt);
        expect(date.getUTCHours()).toBe(0);
        expect(date.getUTCMinutes()).toBe(0);
        expect(date.getUTCSeconds()).toBe(0);
        expect(date.getUTCMilliseconds()).toBe(0);
      }
    }
  });

  // Test date sorting with multiple dimensions
  test("User Engagement API with multiple dimensions should maintain date sorting", async ({
    request,
  }) => {
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: 331,
        dimensions: ["date", "user"],
        metrics: ["executionCount"],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Group results by user to check date sorting within each group
      const resultsByUser = data.results.reduce((acc: any, result: any) => {
        const userId = result.user.id;
        if (!acc[userId]) acc[userId] = [];
        acc[userId].push(result);
        return acc;
      }, {});

      // For each user, verify their dates are sorted chronologically
      Object.values(resultsByUser).forEach((userResults: any) => {
        if (userResults.length > 1) {
          for (let i = 1; i < userResults.length; i++) {
            const prevDate = new Date(userResults[i - 1].date.executedAt);
            const currDate = new Date(userResults[i].date.executedAt);

            expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
          }
        }
      });
    }
  });

  // Test edge case: empty date handling
  test("APIs should handle results with no date data gracefully", async ({
    request,
  }) => {
    // Test with a project that might have minimal data
    const response = await request.post("/api/report-builder/user-engagement", {
      data: {
        projectId: 999999, // Non-existent project
        dimensions: ["date"],
        metrics: ["executionCount"],
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);
    // Should return empty array for non-existent project, which is fine
  });
});

test.describe("Cross-Project Date Sorting @api @reports @admin", () => {
  // Test date sorting for Cross-Project User Engagement API
  test("Cross-Project User Engagement API should sort Activity Date chronologically", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-user-engagement",
      {
        data: {
          dimensions: ["date"],
          metrics: ["executionCount"],
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.executedAt);
        const currDate = new Date(data.results[i].date.executedAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }
    }
  });

  // Test date sorting for Cross-Project Test Execution API
  test("Cross-Project Test Execution API should sort Execution Date chronologically", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-test-execution",
      {
        data: {
          dimensions: ["date"],
          metrics: ["testResultCount"],
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.executedAt);
        const currDate = new Date(data.results[i].date.executedAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }
    }
  });

  // Test date sorting for Cross-Project Repository Stats API
  test("Cross-Project Repository Stats API should sort Creation Date chronologically", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-repository-stats",
      {
        data: {
          dimensions: ["date"],
          metrics: ["testCaseCount"],
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.createdAt);
        const currDate = new Date(data.results[i].date.createdAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }
    }
  });

  // Test date sorting for Cross-Project Issue Tracking API
  test("Cross-Project Issue Tracking API should sort dates chronologically", async ({
    request,
  }) => {
    const response = await request.post(
      "/api/report-builder/cross-project-issue-tracking",
      {
        data: {
          dimensions: ["date"],
          metrics: ["issueCount"],
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.results).toBeInstanceOf(Array);

    if (data.results.length > 1) {
      // Verify dates are sorted chronologically (oldest to newest)
      for (let i = 1; i < data.results.length; i++) {
        const prevDate = new Date(data.results[i - 1].date.createdAt);
        const currDate = new Date(data.results[i].date.createdAt);

        expect(prevDate.getTime()).toBeLessThanOrEqual(currDate.getTime());
      }
    }
  });
});
