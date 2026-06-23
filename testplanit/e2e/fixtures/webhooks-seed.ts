import { createHash, randomBytes } from "node:crypto";
import type { JsonValue } from "@zenstackhq/orm";

import type { AdapterType, WebhookDelivery, WebhookDirection } from "~/zenstack/models";
import type { DbClient } from "~/lib/zenstack";

import { isSlackWebhookUrl } from "../../lib/webhooks/slack-url-detection";
import { encrypt } from "../../utils/encryption";

/**
 * v0.23.0 webhook E2E seed helpers.
 *
 * Reusable fixture functions for the expanded webhook E2E suite. Mirrors the
 * shapes the production server actions and Prisma middleware produce so seeded
 * rows are indistinguishable from rows created via the real flows. Helpers
 * prefer existing service contracts (encryption helper, sentinel issue keys,
 * dispatch row shape) over re-implementing them — adding a new field to a
 * model means updating one place here, not five.
 *
 * Usage pattern: each spec creates its own project via the auto-tracking
 * `api` fixture, then calls these helpers with the resulting `projectId`.
 * Cleanup of project + child rows happens via the `api.cleanup()` cascade.
 *
 * NOT used:
 *   - The OpenAPI spec at `lib/openapi/openapi.json` is ZenStack-derived and
 *     does not surface webhook server actions. Webhook configs are written
 *     by `app/actions/webhook-config.ts` (server-side only) so the helpers
 *     write directly via Prisma, mirroring those actions' final SQL shape.
 */

export type InboundAdapter = "JIRA" | "GITHUB" | "AZURE_DEVOPS";
export type OutboundAdapter = "SLACK" | "GENERIC_HMAC";

export interface SeededOutboundConfig {
  configId: string;
  /** Plaintext signing secret. Empty string for SLACK (URL is the credential). */
  secret: string;
  url: string;
  adapterType: OutboundAdapter;
  token: string;
}

export interface SeededInboundConfig {
  configId: string;
  /** Routing token (`whk_<64-hex>`). Public-but-secret URL key per D-05. */
  token: string;
  /**
   * Plaintext credential. For JIRA / GITHUB this is the HMAC secret; for
   * AZURE_DEVOPS it is the JSON-encoded `{username, password}` string the
   * production action persists (D-09).
   */
  secret: string;
  adapterType: InboundAdapter;
}

export interface SeededDelivery {
  id: string;
  webhookConfigId: string;
  direction: WebhookDirection;
  eventId: string | null;
  statusCode: number | null;
  error: string | null;
  attempt: number;
  replayedFromDeliveryId: string | null;
}

function generateToken(): string {
  return `whk_${randomBytes(32).toString("hex")}`;
}

function generateSecret(): string {
  return randomBytes(48).toString("base64url");
}

/**
 * Seed an OUTBOUND `WebhookConfig` plus (for GENERIC_HMAC) its initial
 * `WebhookConfigSecret` row.
 *
 * Mirrors `createOutboundWebhook` in `app/actions/webhook-config.ts`:
 *   - SLACK: `secret` column is empty (URL is the credential per D-18).
 *   - GENERIC_HMAC: a plaintext signing secret is generated, encrypted, and
 *     written to BOTH `WebhookConfig.secret` (kept in sync per Phase 1
 *     legacy reads) AND a fresh `WebhookConfigSecret` row with
 *     `activatedAt = now()` (the row the dispatcher's two-secret signing
 *     reads from). Skipping the secrets row would make every dispatch
 *     return `error="no_active_signing_secret"`.
 *
 * `subscribedEvents` defaults to `[]` (subscribe-all per D-33). Pass an
 * explicit array to opt-in only to specific events (matches the admin form's
 * behavior when the admin checks individual event boxes).
 */
export async function seedOutboundConfig(
  prisma: DbClient,
  args: {
    projectId: number;
    url: string;
    /** Per-event opt-in list. Empty array (default) = subscribe-all (D-33). */
    events?: string[];
    /**
     * If provided, used as the plaintext HMAC secret instead of a random
     * 48-byte value. Useful when a spec needs to assert the HMAC computed
     * against a known secret without re-reading the config row. Ignored for
     * SLACK adapter (Slack URL IS the credential).
     */
    secret?: string;
    /** Defaults to "E2E Seed Outbound". */
    name?: string;
    /**
     * Override adapter selection. Defaults to GENERIC_HMAC for generic URLs
     * and SLACK for hooks.slack.com URLs (matches production auto-detect).
     */
    adapterType?: OutboundAdapter;
  }
): Promise<SeededOutboundConfig> {
  const adapterType: OutboundAdapter =
    args.adapterType ??
    (isSlackWebhookUrl(args.url) ? "SLACK" : "GENERIC_HMAC");
  const token = generateToken();
  const subscribedEvents = args.events ?? [];
  const name = args.name ?? "E2E Seed Outbound";

  if (adapterType === "SLACK") {
    const config = await prisma.webhookConfig.create({
      data: {
        projectId: args.projectId,
        adapterType: "SLACK",
        direction: "OUTBOUND",
        token,
        secret: "",
        subscribedEvents,
        isActive: true,
        name,
        url: args.url,
      },
      select: { id: true },
    });
    return {
      configId: config.id,
      secret: "",
      url: args.url,
      adapterType: "SLACK",
      token,
    };
  }

  const plaintext = args.secret ?? generateSecret();
  const encrypted = await encrypt(plaintext);

  const created = await prisma.$transaction(async (tx) => {
    const config = await tx.webhookConfig.create({
      data: {
        projectId: args.projectId,
        adapterType: "GENERIC_HMAC",
        direction: "OUTBOUND",
        token,
        secret: encrypted,
        subscribedEvents,
        isActive: true,
        name,
        url: args.url,
      },
      select: { id: true },
    });
    await tx.webhookConfigSecret.create({
      data: {
        webhookConfigId: config.id,
        secret: encrypted,
        activatedAt: new Date(),
      },
    });
    return config;
  });

  return {
    configId: created.id,
    secret: plaintext,
    url: args.url,
    adapterType: "GENERIC_HMAC",
    token,
  };
}

/**
 * Seed an INBOUND `WebhookConfig` for a chosen adapter type.
 *
 * Mirrors `createOrRotateInboundWebhook` in `app/actions/webhook-config.ts`:
 *   - JIRA / GITHUB: server mints a random HMAC secret. Returned plaintext.
 *   - AZURE_DEVOPS: the admin-supplied `{username, password}` pair is
 *     JSON-encoded BEFORE encryption (D-09 — the ADO adapter's `verify()`
 *     calls `JSON.parse(decryptedSecret)` on the receiver side).
 *
 * The encryption helper round-trips arbitrary UTF-8 — special characters in
 * Basic-Auth credentials or HMAC secrets pass through unmodified.
 */
export async function seedInboundConfig(
  prisma: DbClient,
  args: {
    projectId: number;
    adapterType: InboundAdapter;
    /**
     * Required for AZURE_DEVOPS (Basic Auth username + password). Ignored
     * for JIRA / GITHUB (server mints the HMAC secret).
     */
    credentialInput?:
      | { kind: "AZURE_DEVOPS"; username: string; password: string }
      | { kind: "HMAC_SECRET"; secret: string };
  }
): Promise<SeededInboundConfig> {
  const token = generateToken();

  let plaintext: string;
  let userFacingSecret: string;
  if (args.adapterType === "AZURE_DEVOPS") {
    if (!args.credentialInput || args.credentialInput.kind !== "AZURE_DEVOPS") {
      throw new Error(
        "seedInboundConfig: AZURE_DEVOPS requires credentialInput { kind: 'AZURE_DEVOPS', username, password }"
      );
    }
    plaintext = JSON.stringify({
      username: args.credentialInput.username,
      password: args.credentialInput.password,
    });
    userFacingSecret = plaintext;
  } else {
    plaintext =
      args.credentialInput?.kind === "HMAC_SECRET"
        ? args.credentialInput.secret
        : generateSecret();
    userFacingSecret = plaintext;
  }
  const encrypted = await encrypt(plaintext);

  const config = await prisma.webhookConfig.create({
    data: {
      projectId: args.projectId,
      adapterType: args.adapterType as AdapterType,
      direction: "INBOUND",
      token,
      secret: encrypted,
      isActive: true,
    },
    select: { id: true },
  });

  return {
    configId: config.id,
    token,
    secret: userFacingSecret,
    adapterType: args.adapterType,
  };
}

/**
 * Seed an `Issue` row with a non-null `externalKey` so an inbound webhook
 * carrying a matching `linkedRef` can update its `externalStatus`.
 *
 * `externalSystem` is informational metadata (the `Issue` model has no
 * column for it — D-22). It's accepted here for documentation and used by
 * callers that want to correlate the seed with the adapter under test.
 */
export async function seedLinkedIssue(
  prisma: DbClient,
  args: {
    projectId: number;
    /** Adapter-shaped key — e.g. `TP-42` for Jira, `octocat/Hello-World#42` for GitHub, `297` for ADO. */
    externalKey: string;
    /** Documentation-only — Issue model has no externalSystem column. */
    externalSystem: InboundAdapter;
    /** Resolves to the seed test's admin user. */
    createdById: string;
    /** Defaults to "E2E Seed Issue". */
    name?: string;
    /** Defaults to `name`. */
    title?: string;
  }
): Promise<{ issueId: number }> {
  const issue = await prisma.issue.create({
    data: {
      name: args.name ?? "E2E Seed Issue",
      title: args.title ?? args.name ?? "E2E Seed Issue",
      externalKey: args.externalKey,
      isDeleted: false,
      project: { connect: { id: args.projectId } },
      createdBy: { connect: { id: args.createdById } },
    },
    select: { id: true },
  });
  return { issueId: issue.id };
}

/**
 * Seed N `WebhookDelivery` rows for the given config.
 *
 * `statusPattern` controls statusCode/error per row:
 *   - `"all-success"` (default): statusCode=200, error=null
 *   - `"all-failure"`: statusCode=500, error=`<errorSentinel>` (default `"500_seeded"`)
 *   - `"mixed"`: alternates success / failure starting with success (idx % 2 === 0)
 *
 * For OUTBOUND seeds we also write a paired `WebhookOutboxEvent` so the
 * replay service can locate the original payload by `eventId`. INBOUND seeds
 * skip the outbox row (Phase 1 inbound has no outbox concept).
 */
export async function seedDeliveries(
  prisma: DbClient,
  args: {
    webhookConfigId: string;
    direction: WebhookDirection;
    /** OUTBOUND seeds need projectId for the paired outbox row. */
    projectId?: number;
    adapterType: AdapterType;
    eventType?: string;
    count: number;
    statusPattern?: "all-success" | "all-failure" | "mixed";
    errorSentinel?: string;
    /** Stable correlation prefix; defaults to a random 8-char tag. */
    eventIdPrefix?: string;
  }
): Promise<SeededDelivery[]> {
  const pattern = args.statusPattern ?? "all-success";
  const errorSentinel = args.errorSentinel ?? "500_seeded";
  const eventType = args.eventType ?? "test_run.completed";
  const prefix = args.eventIdPrefix ?? `evt_${randomBytes(4).toString("hex")}`;
  const seeded: SeededDelivery[] = [];

  for (let i = 0; i < args.count; i++) {
    const isFailure =
      pattern === "all-failure" || (pattern === "mixed" && i % 2 !== 0);
    const eventId = `${prefix}_${i}`;
    const payload = {
      eventName: eventType,
      eventId,
      projectId: args.projectId,
      seededAt: new Date().toISOString(),
      idx: i,
    };
    const payloadDigest = createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");

    if (args.direction === "OUTBOUND") {
      if (typeof args.projectId !== "number") {
        throw new Error(
          "seedDeliveries: OUTBOUND seeds require projectId for the paired WebhookOutboxEvent"
        );
      }
      await prisma.webhookOutboxEvent.create({
        data: {
          projectId: args.projectId,
          eventName: eventType,
          eventId,
          payload: payload as JsonValue,
          dispatchedAt: new Date(),
        },
      });
    }

    const delivery = await prisma.webhookDelivery.create({
      data: {
        webhookConfigId: args.webhookConfigId,
        direction: args.direction,
        adapterType: args.adapterType,
        eventType,
        eventId: args.direction === "OUTBOUND" ? eventId : null,
        statusCode: isFailure ? 500 : 200,
        latencyMs: 12,
        payloadDigest,
        error: isFailure ? errorSentinel : null,
        attempt: 1,
        replayedFromDeliveryId: null,
      },
      select: {
        id: true,
        webhookConfigId: true,
        direction: true,
        eventId: true,
        statusCode: true,
        error: true,
        attempt: true,
        replayedFromDeliveryId: true,
      },
    });
    seeded.push(delivery as SeededDelivery);
  }

  return seeded;
}

/**
 * Seed an N-deep replay chain. Row 0 is the original (failed) delivery; each
 * subsequent row sets `replayedFromDeliveryId` to the IMMEDIATE PARENT (NOT
 * transitively to row 0 — D-17a invariant: chains are linear, the
 * `replays` self-relation produces a tree where each child points only at
 * its parent).
 *
 * Used by the L-03 spec to verify chain integrity + that the FK
 * `onDelete: SetNull` on `replayedFromDeliveryId` survives a parent purge.
 *
 * `depth` is the total chain length (parent + children). For the L-03 case
 * "trigger fails, replay fails, repeat 5 times" → depth=6 (1 original + 5 replays).
 */
export async function seedReplayChain(
  prisma: DbClient,
  args: {
    webhookConfigId: string;
    projectId: number;
    adapterType: AdapterType;
    depth: number;
    eventType?: string;
    errorSentinel?: string;
  }
): Promise<SeededDelivery[]> {
  if (args.depth < 1) {
    throw new Error("seedReplayChain: depth must be >= 1");
  }
  const eventType = args.eventType ?? "test_run.completed";
  const errorSentinel = args.errorSentinel ?? "500_seeded";
  const chain: SeededDelivery[] = [];

  // Row 0 — the original failed delivery, with its paired outbox event.
  const rootEventId = `evt_chain_${randomBytes(4).toString("hex")}_0`;
  const rootPayload = {
    eventName: eventType,
    eventId: rootEventId,
    projectId: args.projectId,
    seededFor: "replay-chain",
  };
  const rootDigest = createHash("sha256")
    .update(JSON.stringify(rootPayload))
    .digest("hex");
  await prisma.webhookOutboxEvent.create({
    data: {
      projectId: args.projectId,
      eventName: eventType,
      eventId: rootEventId,
      payload: rootPayload,
      dispatchedAt: new Date(),
    },
  });
  const root = await prisma.webhookDelivery.create({
    data: {
      webhookConfigId: args.webhookConfigId,
      direction: "OUTBOUND",
      adapterType: args.adapterType,
      eventType,
      eventId: rootEventId,
      statusCode: 500,
      latencyMs: 12,
      payloadDigest: rootDigest,
      error: errorSentinel,
      attempt: 1,
      replayedFromDeliveryId: null,
    },
    select: {
      id: true,
      webhookConfigId: true,
      direction: true,
      eventId: true,
      statusCode: true,
      error: true,
      attempt: true,
      replayedFromDeliveryId: true,
    },
  });
  chain.push(root as SeededDelivery);

  // Each subsequent row points at the IMMEDIATE PARENT. eventId is shared
  // across the chain (replays carry the original outbox event's eventId, per
  // dispatch.ts:266 — replay path threads delivery.eventId onto the new row).
  for (let i = 1; i < args.depth; i++) {
    const parent = chain[i - 1]!;
    const childPayload = {
      ...rootPayload,
      replayDepth: i,
    };
    const childDigest = createHash("sha256")
      .update(JSON.stringify(childPayload))
      .digest("hex");
    const child = await prisma.webhookDelivery.create({
      data: {
        webhookConfigId: args.webhookConfigId,
        direction: "OUTBOUND",
        adapterType: args.adapterType,
        eventType,
        eventId: rootEventId,
        statusCode: 500,
        latencyMs: 12,
        payloadDigest: childDigest,
        error: errorSentinel,
        attempt: 1,
        replayedFromDeliveryId: parent.id,
      },
      select: {
        id: true,
        webhookConfigId: true,
        direction: true,
        eventId: true,
        statusCode: true,
        error: true,
        attempt: true,
        replayedFromDeliveryId: true,
      },
    });
    chain.push(child as SeededDelivery);
  }

  return chain;
}

/**
 * Soft-delete a project (`isDeleted = true`). Used by the L-05 spec to
 * verify that the dispatcher skips fan-out for soft-deleted projects.
 *
 * The `api` fixture's `cleanup()` already runs the same patch on cleanup,
 * but setting `isDeleted` mid-test (rather than at teardown) is the only
 * way to exercise the dispatcher's soft-delete gate while the test is
 * still in scope.
 */
export async function softDeleteProject(
  prisma: DbClient,
  args: { projectId: number }
): Promise<void> {
  await prisma.projects.update({
    where: { id: args.projectId },
    data: { isDeleted: true },
  });
}

/**
 * Convenience helper — wait until the predicate against a fresh
 * `WebhookDelivery.findMany(where)` returns true. Avoids arbitrary
 * `setTimeout` waits per `feedback_no_flaky_tests.md`.
 */
export async function waitForDeliveries(
  prisma: DbClient,
  args: {
    where: Record<string, unknown>;
    predicate: (rows: WebhookDelivery[]) => boolean;
    timeoutMs?: number;
  }
): Promise<WebhookDelivery[]> {
  const timeoutMs = args.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const rows = await prisma.webhookDelivery.findMany({
      where: args.where,
      orderBy: { receivedAt: "desc" },
    });
    if (args.predicate(rows)) return rows;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `waitForDeliveries: timed out after ${timeoutMs}ms; where=${JSON.stringify(args.where)}`
  );
}
