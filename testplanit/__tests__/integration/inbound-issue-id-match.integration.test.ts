/**
 * Live-DB proof that an inbound tracker event finds the issue the sync
 * stored even when the payload writes its key differently: GitHub sends
 * "owner/repo#42" while the sync stores "#42", so the receiver also matches
 * on the tracker's own id — but only within that tracker's integrations.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ParsedWebhookPayload } from "~/lib/webhooks/adapters/types";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const STAMP = `iim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describeIntegration("Inbound issue match by tracker id (live DB)", () => {
  let db: any;
  let applyInboundIssueUpdate: typeof import("~/lib/webhooks/services/applyInboundIssueUpdate").applyInboundIssueUpdate;

  const fx = {
    creatorId: "",
    projectId: 0,
    githubIntegrationId: 0,
    jiraIntegrationId: 0,
    webhookConfigId: "",
    githubIssueId: 0,
    jiraIssueId: 0,
  };

  function githubEvent(issueNumber: number): ParsedWebhookPayload {
    return {
      eventType: "issues",
      issueKey: `octo/repo#${issueNumber}`,
      externalStatus: "open",
      synthetic: false,
      data: {
        action: "edited",
        issue: { number: issueNumber, state: "open" },
        repository: { full_name: "octo/repo" },
      },
    };
  }

  async function receive(issueNumber: number) {
    return applyInboundIssueUpdate({
      webhookConfigId: fx.webhookConfigId,
      projectId: fx.projectId,
      adapterType: "GITHUB",
      eventType: "issues",
      payload: githubEvent(issueNumber),
      payloadDigest: `${STAMP}-${issueNumber}-${Math.random()}`,
      receivedAt: new Date(),
      latencyMs: 1,
      statusCode: 200,
    });
  }

  async function makeIntegration(provider: "GITHUB" | "JIRA") {
    const row = await db.integration.create({
      data: {
        name: `${provider} ${STAMP}`,
        provider,
        authType: "API_KEY",
        credentials: {},
      },
      select: { id: true },
    });
    return row.id as number;
  }

  beforeAll(async () => {
    process.env.NEXTAUTH_URL ??= "https://tpi.example.com";
    ({ rawDb: db } = await import("~/lib/rawDb"));
    ({ applyInboundIssueUpdate } =
      await import("~/lib/webhooks/services/applyInboundIssueUpdate"));

    const creator = await db.user.findFirst({
      where: { access: "ADMIN" },
      select: { id: true },
    });
    fx.creatorId = creator.id;
    const project = await db.projects.create({
      data: { name: `Inbound id match ${STAMP}`, createdBy: fx.creatorId },
      select: { id: true },
    });
    fx.projectId = project.id;
    fx.githubIntegrationId = await makeIntegration("GITHUB");
    fx.jiraIntegrationId = await makeIntegration("JIRA");

    const config = await db.webhookConfig.create({
      data: {
        projectId: fx.projectId,
        adapterType: "GITHUB",
        direction: "INBOUND",
        token: `whk_${STAMP}`,
        secret: "unused",
        isActive: true,
      },
      select: { id: true },
    });
    fx.webhookConfigId = config.id;

    // Stored the way each tracker's sync writes them.
    const github = await db.issue.create({
      data: {
        name: "#42",
        title: `GitHub 42 ${STAMP}`,
        externalId: "42",
        externalKey: "#42",
        integrationId: fx.githubIntegrationId,
        projectId: fx.projectId,
        createdById: fx.creatorId,
      },
      select: { id: true },
    });
    fx.githubIssueId = github.id;
    const jira = await db.issue.create({
      data: {
        name: "TPI-7",
        title: `Jira 7 ${STAMP}`,
        externalId: "7",
        externalKey: "TPI-7",
        integrationId: fx.jiraIntegrationId,
        projectId: fx.projectId,
        createdById: fx.creatorId,
      },
      select: { id: true },
    });
    fx.jiraIssueId = jira.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.webhookEventDedup
      .deleteMany({ where: { webhookConfigId: fx.webhookConfigId } })
      .catch(() => {});
    await db.webhookDelivery
      .deleteMany({ where: { webhookConfigId: fx.webhookConfigId } })
      .catch(() => {});
    await db.webhookConfig
      .deleteMany({ where: { id: fx.webhookConfigId } })
      .catch(() => {});
    await db.issue
      .deleteMany({ where: { projectId: fx.projectId } })
      .catch(() => {});
    await db.integration
      .deleteMany({
        where: { id: { in: [fx.githubIntegrationId, fx.jiraIntegrationId] } },
      })
      .catch(() => {});
    await db.projects
      .deleteMany({ where: { id: fx.projectId } })
      .catch(() => {});
  });

  it("finds a GitHub issue stored as #42 from an owner/repo#42 event", async () => {
    const result = await receive(42);
    expect(result).toMatchObject({
      outcome: "updated",
      issueId: fx.githubIssueId,
    });
  });

  it("doesn't take another tracker's issue that shares the id", async () => {
    // Jira issue 7 has externalId "7"; a GitHub event for #7 must not match it.
    const result = await receive(7);
    expect(result.outcome).toBe("updated");
    expect(result).not.toHaveProperty("issueId");
  });

  it("still finds an issue by its stored key", async () => {
    await db.issue.update({
      where: { id: fx.githubIssueId },
      data: { externalKey: "octo/repo#42", externalId: "4242" },
    });
    const result = await receive(42);
    expect(result).toMatchObject({
      outcome: "updated",
      issueId: fx.githubIssueId,
    });
  });
});
