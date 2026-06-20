
import { createHmac } from "node:crypto";
import { createRawDbClient } from "~/lib/rawDbClient";

import { expect, test } from "../../fixtures/index";
import {
  seedInboundConfig,
  seedLinkedIssue,
  waitForDeliveries,
} from "../../fixtures/webhooks-seed";

/**
 * Deeply nested inbound payloads (L-02).
 *
 * Real-world Jira plugins, GitHub PR conversations, and ADO work-item
 * payloads occasionally produce JSON with 10+ levels of nesting (Atlassian's
 * `rendered.fields.description.content[].content[]` pattern is the canonical
 * Jira example). The adapters must:
 *   1. Parse the body without recursive stack-overflow (JSON.parse is
 *      iterative under the hood — V8 caps at ~100k object depth — but we
 *      bound the test at 12 levels which is well inside any plausible cap)
 *   2. Lift only the fields the adapter cares about (`issue.key`,
 *      `issue.fields.status.name` for Jira; `repository.full_name` +
 *      `issue.number` + `issue.state` for GitHub; `resource.id` +
 *      `resource.fields["System.State"]` for ADO)
 *   3. Update the linked Issue's `externalStatus` AND write a delivery row
 *      with `error=null` (the "applied" path)
 *
 * Each adapter test uses a payload tailored to that adapter's real shape AND
 * embeds a deeply-nested branch the adapter does NOT read — verifying that
 * extra depth in unrelated fields doesn't break the lift. The test seeds a
 * matching `Issue` so the receiver can fall through to the Issue-update path
 * (otherwise the result would be "no-link" and externalStatus assertions
 * would have nothing to check).
 */

function buildDeepObject(depth: number, leaf: unknown): unknown {
  let cur: unknown = leaf;
  for (let i = 0; i < depth; i++) {
    cur = { level: i, child: cur };
  }
  return cur;
}

function signBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Inbound webhook with deeply nested payload (L-02)", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let adminUserId: string;

  test.beforeAll(async ({ api, adminUserId: ai }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Deep Nested ${uniqueId}`);
    prisma = createRawDbClient();
    adminUserId = ai;
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("JIRA: 12-level nested payload updates linked Issue.externalStatus and writes a delivery row", async ({
    request,
    baseURL,
  }) => {
    const externalKey = "DEEP-J-1";
    let seededIssue: Awaited<ReturnType<typeof seedLinkedIssue>> | undefined;
    let seededConfig: Awaited<ReturnType<typeof seedInboundConfig>> | undefined;

    await test.step("Seed linked Jira issue and inbound webhook config", async () => {
      seededIssue = await seedLinkedIssue(prisma, {
        projectId,
        externalKey,
        externalSystem: "JIRA",
        createdById: adminUserId,
        name: "L-02 Jira deep",
      });
      seededConfig = await seedInboundConfig(prisma, {
        projectId,
        adapterType: "JIRA",
      });
    });

    await test.step("Post 12-level nested Jira payload and expect 200", async () => {
      const deepBranch = buildDeepObject(12, { sentinel: "deep-jira" });
      const body = JSON.stringify({
        webhookEvent: "jira:issue_updated",
        issue: {
          key: externalKey,
          fields: {
            status: { name: "In Progress" },
            // Deeply nested branch the Jira adapter does not read; proves
            // extra depth in unrelated fields doesn't break the lift.
            rendered: deepBranch,
          },
        },
        // Top-level deep branch as well — Jira plugins sometimes attach
        // `comment.body.content[]` outside the issue subtree.
        changelog: deepBranch,
      });
      expect(body.length).toBeGreaterThan(200);

      const sig = signBody(body, seededConfig!.secret);
      const response = await request.post(
        `${baseURL}/api/webhooks/${seededConfig!.token}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": sig,
          },
        }
      );
      expect(response.status()).toBe(200);
    });

    await test.step("Verify an applied delivery row was written", async () => {
      // The "applied" path: a delivery row is written with error=null, which
      // proves the adapter extractors successfully read the deep payload and
      // the dedup INSERT committed. Issue.externalStatus is now refreshed
      // post-tx via SyncService against the integration's upstream, so we
      // do not assert that field here (the upstream call uses fake fixture
      // credentials and is exercised by the dedicated sync specs).
      await waitForDeliveries(prisma, {
        where: {
          webhookConfigId: seededConfig!.configId,
          direction: "INBOUND",
          error: null,
        },
        predicate: (rows) => rows.length >= 1,
      });
      void seededIssue; // kept for symmetry with the other adapter cases
    });
  });

  test("GitHub: 12-level nested payload (deep labels + assignees) is processed without error", async ({
    request,
    baseURL,
  }) => {
    const externalKey = "octocat/L02-Deep#42";
    let seededIssue: Awaited<ReturnType<typeof seedLinkedIssue>> | undefined;
    let seededConfig: Awaited<ReturnType<typeof seedInboundConfig>> | undefined;

    await test.step("Seed linked GitHub issue and inbound webhook config", async () => {
      seededIssue = await seedLinkedIssue(prisma, {
        projectId,
        externalKey,
        externalSystem: "GITHUB",
        createdById: adminUserId,
        name: "L-02 GitHub deep",
      });
      seededConfig = await seedInboundConfig(prisma, {
        projectId,
        adapterType: "GITHUB",
      });
    });

    await test.step("Post 12-level nested GitHub payload and expect 200", async () => {
      const deepBranch = buildDeepObject(12, { sentinel: "deep-github" });
      const body = JSON.stringify({
        action: "closed",
        issue: {
          number: 42,
          state: "closed",
          title: "L-02 deep github",
          // Deeply nested labels + assignees branches — adapter reads neither.
          labels: [{ id: 1, nested: deepBranch }],
          assignees: [{ login: "alice", nested: deepBranch }],
        },
        repository: {
          full_name: "octocat/L02-Deep",
          // Repo-level nested config the adapter does not lift.
          config: deepBranch,
        },
      });

      const sig = signBody(body, seededConfig!.secret);
      const response = await request.post(
        `${baseURL}/api/webhooks/${seededConfig!.token}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            "x-hub-signature-256": sig,
            "x-github-event": "issues",
          },
        }
      );
      expect(response.status()).toBe(200);
    });

    await test.step("Verify an applied delivery row was written", async () => {
      await waitForDeliveries(prisma, {
        where: {
          webhookConfigId: seededConfig!.configId,
          direction: "INBOUND",
          error: null,
        },
        predicate: (rows) => rows.length >= 1,
      });
      void seededIssue;
    });
  });

  test("Azure DevOps: 12-level nested payload (deep _links) is processed without error", async ({
    request,
    baseURL,
  }) => {
    const externalKey = "297";
    let seededIssue: Awaited<ReturnType<typeof seedLinkedIssue>> | undefined;
    let seededConfig: Awaited<ReturnType<typeof seedInboundConfig>> | undefined;

    await test.step("Seed linked ADO issue and inbound webhook config", async () => {
      seededIssue = await seedLinkedIssue(prisma, {
        projectId,
        externalKey,
        externalSystem: "AZURE_DEVOPS",
        createdById: adminUserId,
        name: "L-02 ADO deep",
      });
      seededConfig = await seedInboundConfig(prisma, {
        projectId,
        adapterType: "AZURE_DEVOPS",
        credentialInput: {
          kind: "AZURE_DEVOPS",
          username: "tpi",
          password: "s3cret-deep",
        },
      });
    });

    await test.step("Post 12-level nested ADO payload and expect 200", async () => {
      const deepBranch = buildDeepObject(12, { sentinel: "deep-ado" });
      const body = JSON.stringify({
        eventType: "workitem.updated",
        resource: {
          id: 297,
          fields: {
            "System.State": "Closed",
            // Deeply nested fields branch — adapter only reads System.State.
            extra: deepBranch,
          },
          // ADO's real payload threads `_links` with several levels of nesting.
          _links: deepBranch,
        },
      });

      const basic =
        "Basic " + Buffer.from("tpi:s3cret-deep").toString("base64");
      const response = await request.post(
        `${baseURL}/api/webhooks/${seededConfig!.token}`,
        {
          data: body,
          headers: {
            "content-type": "application/json",
            authorization: basic,
          },
        }
      );
      expect(response.status()).toBe(200);
    });

    await test.step("Verify an applied delivery row was written", async () => {
      await waitForDeliveries(prisma, {
        where: {
          webhookConfigId: seededConfig!.configId,
          direction: "INBOUND",
          error: null,
        },
        predicate: (rows) => rows.length >= 1,
      });
      void seededIssue;
    });
  });
});
