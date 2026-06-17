import { expect, test } from "../../fixtures";

/**
 * Report Builder — Folder and Tag dimensions (live DB)
 *
 * Exercises the test-execution report's new folder and tag groupings against a
 * real database, where the tag many-to-many and folder relation queries (which
 * unit tests mock) actually run:
 *  - folder grouping is flat by default, and rolls descendants up into ancestor
 *    folders when folderIncludeDescendants is set;
 *  - tag grouping fans a multi-tag case out into one row per tag, with untagged
 *    cases collected under a single "None" group.
 * All calls send sec-fetch-site: same-origin (the proxy blocks header-less
 * calls as external API).
 */
const sameOrigin = { "sec-fetch-site": "same-origin" };

const RESULTS_METRIC = "Test Results Count";

function rowFor(results: any[], dimensionKey: string, id: number | null) {
  return results.find((row) => {
    const dim = row[dimensionKey];
    return dim && (id === null ? dim.id == null : Number(dim.id) === id);
  });
}

test("test-execution report groups results by folder, flat and rolled up", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();

  let projectId: number | undefined;
  let parentId: number | undefined;
  let childId: number | undefined;

  await test.step("Create nested folders with a case in each", async () => {
    projectId = await api.createProject(`E2E FolderDim ${ts}`);
    const rootId = await api.getRootFolderId(projectId);
    parentId = await api.createFolder(projectId, `Parent ${ts}`, rootId);
    childId = await api.createFolder(projectId, `Child ${ts}`, parentId);

    const parentCase = await api.createTestCase(
      projectId,
      parentId,
      `PC ${ts}`
    );
    const childCase = await api.createTestCase(projectId, childId, `CC ${ts}`);

    const runId = await api.createTestRun(projectId, `FolderRun ${ts}`);
    const parentRunCase = await api.addTestCaseToTestRun(runId, parentCase);
    const childRunCase = await api.addTestCaseToTestRun(runId, childCase);
    const passedId = await api.getStatusId("passed");
    await api.createTestResult(runId, parentRunCase, passedId);
    await api.createTestResult(runId, childRunCase, passedId);
  });

  await test.step("Verify flat folder grouping counts each folder's own result", async () => {
    // Flat: each folder counts only its own case's result.
    const flat = await request.post(
      `${baseURL}/api/report-builder/test-execution`,
      {
        headers: sameOrigin,
        data: {
          projectId,
          dimensions: ["folder"],
          metrics: ["testResults"],
          pageSize: "All",
        },
      }
    );
    expect(flat.status(), await flat.text()).toBe(200);
    const flatRows = (await flat.json()).results;
    expect(rowFor(flatRows, "folder", parentId!)?.[RESULTS_METRIC]).toBe(1);
    expect(rowFor(flatRows, "folder", childId!)?.[RESULTS_METRIC]).toBe(1);
  });

  await test.step("Verify rolled-up folder grouping includes descendant results", async () => {
    // Rolled up: the parent folder includes the child folder's result too.
    const rolled = await request.post(
      `${baseURL}/api/report-builder/test-execution`,
      {
        headers: sameOrigin,
        data: {
          projectId,
          dimensions: ["folder"],
          metrics: ["testResults"],
          folderIncludeDescendants: true,
          pageSize: "All",
        },
      }
    );
    expect(rolled.status(), await rolled.text()).toBe(200);
    const rolledRows = (await rolled.json()).results;
    expect(rowFor(rolledRows, "folder", parentId!)?.[RESULTS_METRIC]).toBe(2);
    expect(rowFor(rolledRows, "folder", childId!)?.[RESULTS_METRIC]).toBe(1);
  });
});

test("test-execution report groups results by tag with fan-out and a None group", async ({
  api,
  request,
  baseURL,
}) => {
  const ts = Date.now();

  let projectId: number | undefined;
  let taggedCase: number | undefined;
  let untaggedCase: number | undefined;
  let tagA: number | undefined;
  let tagB: number | undefined;

  await test.step("Create a tagged and an untagged case", async () => {
    projectId = await api.createProject(`E2E TagDim ${ts}`);
    const rootId = await api.getRootFolderId(projectId);
    taggedCase = await api.createTestCase(projectId, rootId, `Tagged ${ts}`);
    untaggedCase = await api.createTestCase(
      projectId,
      rootId,
      `Untagged ${ts}`
    );
  });

  await test.step("Attach two tags to the tagged case", async () => {
    tagA = await api.createTag(`tag-a-${ts}`);
    tagB = await api.createTag(`tag-b-${ts}`);
    // Give the tagged case two tags so it fans out into two rows.
    const link = await request.patch(
      `${baseURL}/api/model/repositoryCases/update`,
      {
        headers: sameOrigin,
        data: {
          where: { id: taggedCase },
          data: { tags: { connect: [{ id: tagA }, { id: tagB }] } },
        },
      }
    );
    expect(link.status(), await link.text()).toBeLessThan(300);
  });

  await test.step("Run both cases and record passing results", async () => {
    const runId = await api.createTestRun(projectId!, `TagRun ${ts}`);
    const taggedRunCase = await api.addTestCaseToTestRun(runId, taggedCase!);
    const untaggedRunCase = await api.addTestCaseToTestRun(
      runId,
      untaggedCase!
    );
    const passedId = await api.getStatusId("passed");
    await api.createTestResult(runId, taggedRunCase, passedId);
    await api.createTestResult(runId, untaggedRunCase, passedId);
  });

  await test.step("Verify tag grouping fans out tags and collects untagged under None", async () => {
    const res = await request.post(
      `${baseURL}/api/report-builder/test-execution`,
      {
        headers: sameOrigin,
        data: {
          projectId,
          dimensions: ["tag"],
          metrics: ["testResults"],
          pageSize: "All",
        },
      }
    );
    expect(res.status(), await res.text()).toBe(200);
    const rows = (await res.json()).results;

    // The tagged case's single result counts toward both of its tags.
    expect(rowFor(rows, "tag", tagA!)?.[RESULTS_METRIC]).toBe(1);
    expect(rowFor(rows, "tag", tagB!)?.[RESULTS_METRIC]).toBe(1);
    // The untagged case lands in the null "None" group.
    expect(rowFor(rows, "tag", null)?.[RESULTS_METRIC]).toBe(1);
  });
});
