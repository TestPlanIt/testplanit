import { TestPlanItClient } from "../../../../packages/api/src/client";
import { expect, test } from "../../fixtures/index";

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

/**
 * The Playwright reporter copies a test's tags onto its test case with
 * `TestPlanItClient.resolveTagIds` and `TestPlanItClient.setTestCaseTags`.
 * These tests run that client code, authenticated with an API token as a
 * reporter is, against the real server.
 */
test.describe("Reporter case tags (API client against the server)", () => {
  let client: TestPlanItClient;
  let projectId: number;
  let caseId: number;
  const unique = Date.now();
  const smoke = `smoke-${unique}`;
  const critical = `critical-${unique}`;
  const checkout = `checkout-${unique}`;
  const manual = `added-by-hand-${unique}`;

  async function caseTagNames(
    request: import("@playwright/test").APIRequestContext,
    baseURL: string | undefined
  ): Promise<string[]> {
    const response = await request.get(
      `${baseURL}/api/model/repositoryCaseTag/findMany`,
      {
        params: {
          q: JSON.stringify({
            where: { caseId },
            select: { tag: { select: { name: true } } },
          }),
        },
      }
    );
    expect(response.ok()).toBe(true);
    const rows = (await response.json()).data as { tag: { name: string } }[];
    return rows.map((row) => row.tag.name).sort();
  }

  test.beforeAll(async ({ request, baseURL }) => {
    const response = await request.post(`${baseURL}/api/api-tokens`, {
      data: { name: `reporter-case-tags-${unique}` },
    });
    expect(response.status()).toBe(200);
    const token = (await response.json()).token as string;
    client = new TestPlanItClient({ baseUrl: baseURL!, apiToken: token });
  });

  test("adds tags to a case, creating the ones that do not exist", async ({
    api,
    request,
    baseURL,
  }) => {
    await test.step("Create a project, a folder and a case", async () => {
      projectId = await api.createProject(`E2E Reporter Tags ${unique}`);
      const folderId = await api.createFolder(projectId, "Reporter tags");
      caseId = await api.createTestCase(projectId, folderId, "Pays by card");
    });

    await test.step("Set two tags that do not exist yet", async () => {
      const tagIds = await client.resolveTagIds(projectId, [smoke, critical]);
      const result = await client.setTestCaseTags(caseId, tagIds);
      expect(result).toEqual({ added: 2, removed: 0 });
    });

    await test.step("The case has both tags", async () => {
      expect(await caseTagNames(request, baseURL)).toEqual(
        [critical, smoke].sort()
      );
    });
  });

  test("without replace, keeps a tag that was added by hand", async ({
    api,
    request,
    baseURL,
  }) => {
    await test.step("Add a tag to the case outside the reporter", async () => {
      const manualTagId = await api.createTag(manual);
      await api.addTagToTestCase(caseId, manualTagId);
    });

    await test.step("Set one of the existing tags again", async () => {
      const tagIds = await client.resolveTagIds(projectId, [smoke]);
      const result = await client.setTestCaseTags(caseId, tagIds);
      expect(result).toEqual({ added: 0, removed: 0 });
    });

    await test.step("All three tags are still on the case", async () => {
      expect(await caseTagNames(request, baseURL)).toEqual(
        [critical, manual, smoke].sort()
      );
    });
  });

  test("with replace, the case ends up with exactly the given tags", async ({
    request,
    baseURL,
  }) => {
    await test.step("Replace the tags with one kept tag and one new tag", async () => {
      const tagIds = await client.resolveTagIds(projectId, [smoke, checkout]);
      const result = await client.setTestCaseTags(caseId, tagIds, {
        replace: true,
      });
      expect(result).toEqual({ added: 1, removed: 2 });
    });

    await test.step("Only those two tags are on the case", async () => {
      expect(await caseTagNames(request, baseURL)).toEqual(
        [checkout, smoke].sort()
      );
    });
  });

  test("with replace and no tags, clears the case's tags", async ({
    request,
    baseURL,
  }) => {
    await test.step("Replace the tags with an empty list", async () => {
      const result = await client.setTestCaseTags(caseId, [], {
        replace: true,
      });
      expect(result).toEqual({ added: 0, removed: 2 });
    });

    await test.step("The case has no tags", async () => {
      expect(await caseTagNames(request, baseURL)).toEqual([]);
    });
  });
});
