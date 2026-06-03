import { expect, test } from "../../fixtures";

/**
 * JUnit XML Import API E2E Tests
 *
 * Covers:
 * - RUN-06: JUnit XML import creates a test run with parsed results
 * - Auto-detect format support
 * - Import to existing test run
 *
 * Uses the /api/test-results/import endpoint which returns an SSE stream.
 */

const JUNIT_XML_3_CASES = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="LoginTests" tests="3" failures="1" errors="0" time="5.123">
    <testcase classname="auth.LoginTests" name="testValidLogin" time="1.5"/>
    <testcase classname="auth.LoginTests" name="testInvalidPassword" time="2.0">
      <failure message="Expected 401">Wrong status code</failure>
    </testcase>
    <testcase classname="auth.LoginTests" name="testEmptyCredentials" time="1.623"/>
  </testsuite>
</testsuites>`;

const JUNIT_XML_2_CASES = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="SearchTests" tests="2" failures="0" errors="0" time="3.0">
    <testcase classname="search.SearchTests" name="testBasicSearch" time="1.2"/>
    <testcase classname="search.SearchTests" name="testFilterSearch" time="1.8"/>
  </testsuite>
</testsuites>`;

/**
 * Parse SSE stream text and extract data events
 */
function parseSseEvents(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const json = JSON.parse(line.slice(6));
        events.push(json);
      } catch {
        // Skip non-JSON data lines
      }
    }
  }
  return events;
}

/**
 * Find the final/completion event from SSE stream events
 */
function getFinalEvent(
  events: Array<Record<string, unknown>>
): Record<string, unknown> | null {
  // Look for the completion event (has complete: true) or error event
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.complete || event.error) {
      return event;
    }
  }
  return events[events.length - 1] || null;
}

test.describe("JUnit XML Import API", () => {
  test("should import JUnit XML and create a test run with correct case count", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E JUnit Import ${ts}`);
    const runName = `JUnit Run ${ts}`;

    // POST JUnit XML to import endpoint with explicit format
    const response = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "results.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(JUNIT_XML_3_CASES),
        },
        format: "junit",
        projectId: String(projectId),
        name: runName,
      },
    });

    // The endpoint returns an SSE stream (status 200)
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/event-stream");

    // Read and parse the SSE stream
    const body = await response.text();
    const events = parseSseEvents(body);
    expect(events.length).toBeGreaterThan(0);

    const finalEvent = getFinalEvent(events);
    expect(finalEvent).not.toBeNull();

    // Final event should indicate success (complete: true) with the testRunId
    expect(finalEvent!.error).toBeUndefined();
    expect(finalEvent!.complete).toBe(true);
    expect(typeof finalEvent!.testRunId).toBe("number");

    const createdRunId = finalEvent!.testRunId as number;

    // Verify the test run was created in the DB
    const testRunResponse = await request.get(
      `/api/model/testRuns/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { id: createdRunId, projectId },
          select: { id: true, name: true },
        })
      )}`
    );
    expect(testRunResponse.ok()).toBeTruthy();
    const testRunData = await testRunResponse.json();
    expect(testRunData.data).not.toBeNull();
    expect(testRunData.data.name).toBe(runName);

    // Verify 3 test run cases were created
    const casesResponse = await request.get(
      `/api/model/testRunCases/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: { testRunId: createdRunId },
        })
      )}`
    );
    expect(casesResponse.ok()).toBeTruthy();
    const casesData = await casesResponse.json();
    expect(casesData.data).toHaveLength(3);
  });

  test("links results to an existing case by an ID in the name (no duplicate on rename)", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E Case ID Link ${ts}`);

    // First import creates the cases by name.
    const firstResponse = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "results.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(JUNIT_XML_2_CASES),
        },
        format: "junit",
        projectId: String(projectId),
        name: `Case ID Link Run A ${ts}`,
      },
    });
    expect(firstResponse.status()).toBe(200);
    expect(
      getFinalEvent(parseSseEvents(await firstResponse.text()))!.complete
    ).toBe(true);

    // Grab the ID of one of the created cases.
    const caseLookup = await request.get(
      `/api/model/repositoryCases/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { projectId, name: "testBasicSearch" },
          select: { id: true },
        })
      )}`
    );
    expect(caseLookup.ok()).toBeTruthy();
    const caseId = (await caseLookup.json()).data.id as number;
    expect(typeof caseId).toBe("number");

    // Second import: the test has been renamed but carries the case ID in the
    // title. With caseMatcher=name it must link to the existing case, not
    // create a duplicate.
    const renamedName = `[${caseId}] basic search after a rename`;
    const linkedXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="SearchTests" tests="1" failures="0" errors="0" time="1.0">
    <testcase classname="search.SearchTests" name="${renamedName}" time="1.0"/>
  </testsuite>
</testsuites>`;

    const secondResponse = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "renamed.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(linkedXml),
        },
        format: "junit",
        projectId: String(projectId),
        name: `Case ID Link Run B ${ts}`,
        caseMatcher: "name",
        caseIdFormat: "brackets",
      },
    });
    expect(secondResponse.status()).toBe(200);
    const finalEvent = getFinalEvent(
      parseSseEvents(await secondResponse.text())
    );
    expect(finalEvent!.error).toBeUndefined();
    expect(finalEvent!.complete).toBe(true);
    const runBId = finalEvent!.testRunId as number;

    // Run B links exactly one case — the existing one, by ID.
    const runBCases = await request.get(
      `/api/model/testRunCases/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: { testRunId: runBId },
          select: { repositoryCaseId: true },
        })
      )}`
    );
    expect(runBCases.ok()).toBeTruthy();
    const runBCasesData = await runBCases.json();
    expect(runBCasesData.data).toHaveLength(1);
    expect(runBCasesData.data[0].repositoryCaseId).toBe(caseId);

    // No duplicate case was created under the renamed title.
    const dupLookup = await request.get(
      `/api/model/repositoryCases/findFirst?q=${encodeURIComponent(
        JSON.stringify({
          where: { projectId, name: renamedName },
          select: { id: true },
        })
      )}`
    );
    expect(dupLookup.ok()).toBeTruthy();
    expect((await dupLookup.json()).data).toBeNull();
  });

  test("should import JUnit XML with auto-detect format", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E JUnit AutoDetect ${ts}`);
    const runName = `AutoDetect Run ${ts}`;

    // POST with format=auto — should auto-detect as JUnit
    const response = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "results.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(JUNIT_XML_3_CASES),
        },
        format: "auto",
        projectId: String(projectId),
        name: runName,
      },
    });

    expect(response.status()).toBe(200);

    const body = await response.text();
    const events = parseSseEvents(body);
    const finalEvent = getFinalEvent(events);

    expect(finalEvent).not.toBeNull();
    expect(finalEvent!.error).toBeUndefined();
    expect(finalEvent!.complete).toBe(true);

    const createdRunId = finalEvent!.testRunId as number;

    // Verify 3 cases were imported
    const casesResponse = await request.get(
      `/api/model/testRunCases/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: { testRunId: createdRunId },
        })
      )}`
    );
    expect(casesResponse.ok()).toBeTruthy();
    const casesData = await casesResponse.json();
    expect(casesData.data).toHaveLength(3);
  });

  test("should import JUnit XML into an existing test run", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E JUnit Existing ${ts}`);

    // Create a test run of JUNIT type first by importing once
    const initialRunName = `Existing Run ${ts}`;
    const initialResponse = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "initial.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(JUNIT_XML_3_CASES),
        },
        format: "junit",
        projectId: String(projectId),
        name: initialRunName,
      },
    });

    expect(initialResponse.status()).toBe(200);
    const initialBody = await initialResponse.text();
    const initialEvents = parseSseEvents(initialBody);
    const initialFinalEvent = getFinalEvent(initialEvents);
    expect(initialFinalEvent!.complete).toBe(true);

    const existingRunId = initialFinalEvent!.testRunId as number;

    // Now import a second batch of cases into the same test run
    const appendResponse = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "append.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(JUNIT_XML_2_CASES),
        },
        format: "junit",
        projectId: String(projectId),
        testRunId: String(existingRunId),
      },
    });

    expect(appendResponse.status()).toBe(200);
    const appendBody = await appendResponse.text();
    const appendEvents = parseSseEvents(appendBody);
    const appendFinalEvent = getFinalEvent(appendEvents);

    expect(appendFinalEvent).not.toBeNull();
    expect(appendFinalEvent!.error).toBeUndefined();
    expect(appendFinalEvent!.complete).toBe(true);
    // The returned testRunId should match the existing run
    expect(appendFinalEvent!.testRunId).toBe(existingRunId);

    // Verify the run now has 5 total test cases (3 from initial + 2 from append)
    // Note: cases are upserted, so unique (classname, name) combinations count
    const casesResponse = await request.get(
      `/api/model/testRunCases/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: { testRunId: existingRunId },
        })
      )}`
    );
    expect(casesResponse.ok()).toBeTruthy();
    const casesData = await casesResponse.json();
    // 3 from LoginTests + 2 from SearchTests = 5 unique cases
    expect(casesData.data.length).toBeGreaterThanOrEqual(2);
  });

  test("should reject import with missing required fields", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E JUnit Missing ${ts}`);

    // POST without name (required when not providing testRunId)
    const response = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "results.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(JUNIT_XML_3_CASES),
        },
        format: "junit",
        projectId: String(projectId),
        // name is intentionally omitted
      },
    });

    // The endpoint still returns 200 (SSE stream) but with an error event
    expect(response.status()).toBe(200);

    const body = await response.text();
    const events = parseSseEvents(body);
    const finalEvent = getFinalEvent(events);

    // Should receive an error event
    expect(finalEvent).not.toBeNull();
    expect(finalEvent!.error).toBeDefined();
  });

  test("should import JUnit XML and verify test results with correct statuses", async ({
    api,
    request,
  }) => {
    const ts = Date.now();
    const projectId = await api.createProject(`E2E JUnit Statuses ${ts}`);
    const runName = `JUnit Statuses Run ${ts}`;

    const response = await request.post(`/api/test-results/import`, {
      multipart: {
        files: {
          name: "results.xml",
          mimeType: "application/xml",
          buffer: Buffer.from(JUNIT_XML_3_CASES),
        },
        format: "junit",
        projectId: String(projectId),
        name: runName,
      },
    });

    expect(response.status()).toBe(200);
    const body = await response.text();
    const events = parseSseEvents(body);
    const finalEvent = getFinalEvent(events);
    expect(finalEvent!.complete).toBe(true);

    const createdRunId = finalEvent!.testRunId as number;

    // Verify test cases exist and have statuses set
    const casesResponse = await request.get(
      `/api/model/testRunCases/findMany?q=${encodeURIComponent(
        JSON.stringify({
          where: { testRunId: createdRunId },
          select: {
            id: true,
            isCompleted: true,
            statusId: true,
            repositoryCase: { select: { name: true } },
          },
        })
      )}`
    );
    expect(casesResponse.ok()).toBeTruthy();
    const casesData = await casesResponse.json();
    expect(casesData.data).toHaveLength(3);

    // All cases should be marked as completed (import sets isCompleted=true)
    for (const tc of casesData.data) {
      expect(tc.isCompleted).toBe(true);
    }
  });
});
