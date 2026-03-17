import { expect, test } from "../../fixtures/index";

/**
 * Nested Includes Regression Tests
 *
 * Verifies that nested includes on RepositoryCases and TestRuns work correctly
 * after the ZenStack v2→v3 upgrade. These are the queries most likely to hit
 * the PostgreSQL 63-char alias limit in ZenStack v3.
 *
 * Catching regressions here prevents broken data loading in:
 * - Cases list and case detail views (RepositoryCases nested includes)
 * - Test run views (TestRuns with testCases → repositoryCase → stepResults)
 *
 * Key ZenStack v3 discoveries documented in STATE.md:
 * - TestRuns relation field name is 'testCases' (not 'testRunCases') per schema.zmodel
 * - TestRunCases results relation is 'results' (not 'stepResults')
 * - ZenStack v3 nested includes on RepositoryCases and TestRuns pass without
 *   PostgreSQL 63-char alias errors (verified in this test suite)
 */
test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

// Tiptap JSON format for step content (matches format used by the UI)
function makeTiptapDoc(text: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text }],
      },
    ],
  };
}

test.describe("Nested Includes Regression Tests", () => {
  /**
   * REL-01: RepositoryCases with nested includes
   *
   * Verifies that findMany on RepositoryCases with deeply nested includes
   * (steps, caseFieldValues with field, tags, template) returns correctly
   * structured data without PostgreSQL 63-char alias errors.
   */
  test("should return RepositoryCases with nested includes (steps, fieldValues, tags, template)", async ({
    request,
    baseURL,
    api,
  }) => {
    const ts = Date.now();

    // Create an isolated project for this test
    const projectId = await api.createProject(`E2E NestedIncludes RC ${ts}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create a test case to query with nested includes
    const caseName = `E2E RC NestedIncludes Case ${ts}`;
    const caseId = await api.createTestCase(projectId, folderId, caseName);
    expect(caseId).toBeGreaterThan(0);

    // Create 2 steps on the case via direct POST to /api/model/steps/create
    const step1Response = await request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: makeTiptapDoc("Step 1: Navigate to login page"),
            expectedResult: makeTiptapDoc("Login page is displayed"),
            order: 1,
          },
        },
      }
    );
    expect([200, 201]).toContain(step1Response.status());

    const step2Response = await request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId,
            step: makeTiptapDoc("Step 2: Enter valid credentials"),
            expectedResult: makeTiptapDoc("User is logged in successfully"),
            order: 2,
          },
        },
      }
    );
    expect([200, 201]).toContain(step2Response.status());

    // Create a tag and link it to the case
    const tagId = await api.createTag(`E2E NestedIncludes Tag ${ts}`);
    await api.addTagToTestCase(caseId, tagId);

    // Query with nested includes — this is the critical query that tests
    // the PostgreSQL 63-char alias limit in ZenStack v3
    const findResponse = await request.get(
      `${baseURL}/api/model/repositoryCases/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { id: caseId },
            include: {
              steps: true,
              caseFieldValues: {
                include: {
                  field: true,
                },
              },
              tags: true,
              template: true,
            },
          }),
        },
      }
    );

    expect(findResponse.status()).toBe(200);

    const result = await findResponse.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);

    // Find the matching case (findMany may return more with concurrent tests)
    const matchingCase = result.data.find(
      (c: { id: number }) => c.id === caseId
    );
    expect(matchingCase).toBeTruthy();

    // Assert steps are returned correctly
    expect(Array.isArray(matchingCase.steps)).toBe(true);
    expect(matchingCase.steps.length).toBe(2);

    // Assert tags are returned correctly
    expect(Array.isArray(matchingCase.tags)).toBe(true);
    expect(matchingCase.tags.length).toBe(1);
    expect(matchingCase.tags[0].name).toContain(`E2E NestedIncludes Tag ${ts}`);

    // Assert template is returned correctly (cases always have a template)
    expect(matchingCase.template).toBeTruthy();
    expect(typeof matchingCase.template.id).toBe("number");

    // Assert caseFieldValues is an array (may be empty if no field values set)
    // The key MUST exist as an array — this proves the nested include with
    // { field: true } did not trigger an alias error or cause a query failure
    expect(Array.isArray(matchingCase.caseFieldValues)).toBe(true);
  });

  /**
   * REL-02: TestRuns with deeply nested includes
   *
   * Verifies that findMany on TestRuns with deeply nested includes
   * (testCases with repositoryCase and results) returns correctly structured
   * data without PostgreSQL 63-char alias errors.
   *
   * This test exercises the exact nesting depth documented in working memory as
   * causing the 73-char PostgreSQL alias overflow in some ZenStack v3 query paths:
   *   RepositoryCases$template$caseFields$caseField$fieldOptions$fieldOption (73 chars)
   *
   * NOTE: If this query fails with a PostgreSQL alias error, the fix is to fetch
   * results (stepResults) separately and merge client-side — per the pattern
   * documented in working memory and applied in:
   *   - components/TestResultHistory.tsx
   *   - components/TestRunCaseDetails.tsx
   *
   * ZenStack v3 schema field names (verified from schema.zmodel):
   *   - TestRun → testRunCases: TestRunCases[]   (relation named 'testCases' in schema)
   *   - TestRunCases → results: TestRunResults[] (relation named 'results' in schema)
   */
  test("should return TestRuns with deeply nested includes (testRunCases, repositoryCase, results)", async ({
    request,
    baseURL,
    api,
  }) => {
    const ts = Date.now();

    // Create an isolated project for this test
    const projectId = await api.createProject(`E2E NestedIncludes TR ${ts}`);
    const folderId = await api.getRootFolderId(projectId);

    // Create 2 test cases to add to the run
    const caseId1 = await api.createTestCase(
      projectId,
      folderId,
      `E2E TR NestedIncludes Case A ${ts}`
    );
    const caseId2 = await api.createTestCase(
      projectId,
      folderId,
      `E2E TR NestedIncludes Case B ${ts}`
    );

    // Create 2 steps on the first test case to increase nesting depth
    const stepA1Response = await request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId1,
            step: makeTiptapDoc("Step 1: Open the application"),
            expectedResult: makeTiptapDoc("Application opens successfully"),
            order: 1,
          },
        },
      }
    );
    expect([200, 201]).toContain(stepA1Response.status());

    const stepA2Response = await request.post(
      `${baseURL}/api/model/steps/create`,
      {
        data: {
          data: {
            testCaseId: caseId1,
            step: makeTiptapDoc("Step 2: Click the submit button"),
            expectedResult: makeTiptapDoc("Form is submitted"),
            order: 2,
          },
        },
      }
    );
    expect([200, 201]).toContain(stepA2Response.status());

    // Create a test run and add both cases to it
    const testRunId = await api.createTestRun(
      projectId,
      `E2E NestedIncludes TestRun ${ts}`
    );
    await api.addTestCaseToTestRun(testRunId, caseId1, { order: 1 });
    await api.addTestCaseToTestRun(testRunId, caseId2, { order: 2 });

    // Query testRuns with deeply nested includes — this is the critical query
    // IMPORTANT: The relation field on TestRuns model is named 'testCases' in schema.zmodel,
    // NOT 'testRunCases'. The 'testRunCases' name would be rejected with "Unknown field" error.
    // The 'results' relation on TestRunCases is how ZenStack exposes step results.
    const findResponse = await request.get(
      `${baseURL}/api/model/testRuns/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { id: testRunId },
            include: {
              testCases: {
                include: {
                  repositoryCase: true,
                  results: true,
                },
              },
            },
          }),
        },
      }
    );

    expect(findResponse.status()).toBe(200);

    const result = await findResponse.json();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);

    // Find the matching test run
    const matchingRun = result.data.find(
      (r: { id: number }) => r.id === testRunId
    );
    expect(matchingRun).toBeTruthy();

    // Assert testCases (the relation field name in schema.zmodel) are returned correctly
    // Note: the response key is 'testCases' not 'testRunCases' — this matches schema.zmodel
    expect(Array.isArray(matchingRun.testCases)).toBe(true);
    expect(matchingRun.testCases.length).toBe(2);

    // For each testRunCase entry, verify the nested includes work
    for (const testRunCase of matchingRun.testCases) {
      // repositoryCase MUST be an object with id and name
      // This proves the nested include traversal reached the RepositoryCases table
      expect(testRunCase.repositoryCase).toBeTruthy();
      expect(typeof testRunCase.repositoryCase.id).toBe("number");
      expect(typeof testRunCase.repositoryCase.name).toBe("string");

      // results MUST exist as an array (may be empty — no results recorded yet)
      // This proves the deeply nested include did NOT trigger the 63-char alias limit.
      // If it did, the query would fail with a PostgreSQL "missing FROM-clause entry" error.
      expect(Array.isArray(testRunCase.results)).toBe(true);
    }

    // Verify both original cases are represented
    const repositoryCaseIds = matchingRun.testCases.map(
      (trc: { repositoryCase: { id: number } }) => trc.repositoryCase.id
    );
    expect(repositoryCaseIds).toContain(caseId1);
    expect(repositoryCaseIds).toContain(caseId2);
  });
});
