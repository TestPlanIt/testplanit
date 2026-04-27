"use server";

import { createHmac, randomBytes } from "node:crypto";

import { prisma } from "~/lib/prisma";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { SYNTHETIC_ISSUE_KEY } from "~/lib/webhooks/adapters/jira";
import { canManageWebhookConfig } from "~/lib/webhooks/auth";
import { webhookEvents } from "~/lib/webhooks/events";
import { isSlackWebhookUrl } from "~/lib/webhooks/slack-url-detection";
import { decrypt, encrypt } from "~/utils/encryption";
import { getServerAuthSession } from "~/server/auth";

/**
 * D-20 / BLOCKER #5 / HI-02 — byte-identical synthetic payload across clicks.
 *
 * The two-click SC#5 demo determinism depends on this payload being LITERALLY
 * the same bytes every time `sendTestWebhook` runs. A `Date.now`, a `nonce`,
 * or a fresh `randomUUID` here would produce a new `payloadDigest` per click,
 * which would skip the dedup-INSERT P2002 path that the demo relies on.
 *
 * Static literal → identical SHA-256 digest → second click of `sendTestWebhook`
 * deterministically returns `outcome='duplicate'` from the receiver. SC#5 demo lock.
 *
 * HI-02: synthetic intent is bound to `issue.key === SYNTHETIC_ISSUE_KEY` (the
 * sentinel `__synthetic__`). The receiver-side adapter detects that exact key
 * to short-circuit; we no longer use a wire-controllable `metadata.synthetic`
 * boolean (which any HMAC-valid sender could forge). A real Jira instance
 * cannot legitimately produce an issue with this key, so the synthetic path
 * is reachable only by the server's own self-loop.
 */
const SYNTHETIC_PAYLOAD = JSON.stringify({
  webhookEvent: "jira:issue_updated",
  issue: {
    key: SYNTHETIC_ISSUE_KEY,
    fields: { status: { name: "Synthetic Test" } },
  },
});

function generateToken(): string {
  // 32 random bytes → 64 hex chars; "whk_" prefix per D-05.
  return `whk_${randomBytes(32).toString("hex")}`;
}

function generateSecret(): string {
  // 48 random bytes → ~64 base64url chars. Plenty of entropy for HMAC.
  return randomBytes(48).toString("base64url");
}

export interface CreateOrRotateResult {
  success: boolean;
  configId?: string;
  url?: string; // full URL with token visible — show ONCE on creation/rotation (D-19)
  secret?: string; // plaintext secret — show ONCE on creation/rotation (D-06)
  error?: string;
}

/**
 * Creates a new Jira inbound `WebhookConfig` for the project, or rotates the
 * token + secret of the existing one (D-07: hard cutover, no grace period).
 *
 * Always uses `getEnhancedDb(session)` so ZenStack policies enforce the
 * project-admin gate established in plan 01-01 (ADMIN-01 / D-21).
 */
export async function createOrRotateJiraWebhook(
  projectId: number
): Promise<CreateOrRotateResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  // CR-02: schema denies all client writes; this server action authorizes the
  // caller explicitly (mirroring the prior @@allow policy) and writes via raw
  // `prisma` to bypass the deny.
  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, projectId);
  } catch (err) {
    console.error("[webhook-config] auth check failed", err);
    return { success: false, error: "Failed to save webhook configuration" };
  }
  if (!authorized) {
    return { success: false, error: "Forbidden" };
  }

  const token = generateToken();
  const plaintextSecret = generateSecret();

  let encryptedSecret: string;
  try {
    encryptedSecret = await encrypt(plaintextSecret);
  } catch (err) {
    console.error("[webhook-config] encrypt failed", err);
    return { success: false, error: "Failed to save webhook configuration" };
  }

  const origin = process.env.NEXTAUTH_URL ?? "";
  const url = `${origin}/api/webhooks/${token}`;

  try {
    const existing = await prisma.webhookConfig.findFirst({
      where: { projectId, adapterType: "JIRA", direction: "INBOUND" },
      select: { id: true },
    });

    let config: { id: string };
    if (existing) {
      // D-07: rotation overwrites — old token immediately invalid.
      config = await prisma.webhookConfig.update({
        where: { id: existing.id },
        data: { token, secret: encryptedSecret, isActive: true },
        select: { id: true },
      });
    } else {
      config = await prisma.webhookConfig.create({
        data: {
          projectId,
          adapterType: "JIRA",
          direction: "INBOUND",
          token,
          secret: encryptedSecret,
          isActive: true,
        },
        select: { id: true },
      });
    }

    return {
      success: true,
      configId: config.id,
      url,
      secret: plaintextSecret,
    };
  } catch (err) {
    // ME-03 / HI-05: discriminate the concurrent-create race using the
    // shared `isUniqueConstraintError` helper. If two admins click
    // 'Configure Jira webhook' simultaneously, both findFirst() return
    // null, both attempt create(), one wins and the loser hits P2002 on
    // the @@unique([projectId, adapterType, direction]) constraint. The
    // loser falls back to a single retry that takes the rotate-existing
    // branch — yielding the same end-state as the winner: one config row,
    // a fresh URL/secret pair returned. (Server actions are
    // non-recursive so we cap at one retry; if that also fails we
    // surface the friendly error.)
    if (isUniqueConstraintError(err)) {
      console.warn(
        "[webhook-config] createOrRotate hit concurrent-create race; retrying via rotate path"
      );
      try {
        const existing = await prisma.webhookConfig.findFirst({
          where: { projectId, adapterType: "JIRA", direction: "INBOUND" },
          select: { id: true },
        });
        if (existing) {
          const config = await prisma.webhookConfig.update({
            where: { id: existing.id },
            data: { token, secret: encryptedSecret, isActive: true },
            select: { id: true },
          });
          return {
            success: true,
            configId: config.id,
            url,
            secret: plaintextSecret,
          };
        }
      } catch (retryErr) {
        console.error(
          "[webhook-config] createOrRotate concurrent-race retry failed",
          retryErr
        );
      }
    }
    console.error("[webhook-config] createOrRotate failed", err);
    return { success: false, error: "Failed to save webhook configuration" };
  }
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

/**
 * Hard-deletes the webhook config row. The schema does NOT carry an
 * `isDeleted` field on `WebhookConfig` (verified vs plan 01-01 SUMMARY) so
 * `feedback_soft_delete` does not apply — admin-only configuration entity,
 * not user data.
 */
export async function deleteJiraWebhook(
  configId: string
): Promise<DeleteResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  // CR-02: authorize before raw write. Look up the config's projectId so the
  // helper can match the caller against the right project's admin list.
  let projectId: number;
  try {
    const config = await prisma.webhookConfig.findUnique({
      where: { id: configId },
      select: { projectId: true },
    });
    if (!config) {
      return { success: false, error: "Not found" };
    }
    projectId = config.projectId;
  } catch (err) {
    console.error("[webhook-config] lookup failed (delete)", err);
    return { success: false, error: "Failed to delete webhook configuration" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, projectId);
  } catch (err) {
    console.error("[webhook-config] auth check failed (delete)", err);
    return { success: false, error: "Failed to delete webhook configuration" };
  }
  if (!authorized) {
    return { success: false, error: "Forbidden" };
  }

  try {
    await prisma.webhookConfig.delete({ where: { id: configId } });
    return { success: true };
  } catch (err) {
    console.error("[webhook-config] delete failed", err);
    return { success: false, error: "Failed to delete webhook configuration" };
  }
}

export interface SetActiveResult {
  success: boolean;
  error?: string;
}

/**
 * CR-02: replaces the form's previous `useUpdateWebhookConfig` ZenStack RPC
 * call. Toggles `isActive` only — no other field is mutable here. Schema
 * `@@deny('create, update, delete', true)` blocks any client-side write,
 * so this server action is the sole `isActive` mutation surface.
 */
export async function setWebhookActive(
  configId: string,
  isActive: boolean
): Promise<SetActiveResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  let projectId: number;
  try {
    const config = await prisma.webhookConfig.findUnique({
      where: { id: configId },
      select: { projectId: true },
    });
    if (!config) {
      return { success: false, error: "Not found" };
    }
    projectId = config.projectId;
  } catch (err) {
    console.error("[webhook-config] lookup failed (setActive)", err);
    return { success: false, error: "Failed to update webhook configuration" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, projectId);
  } catch (err) {
    console.error("[webhook-config] auth check failed (setActive)", err);
    return { success: false, error: "Failed to update webhook configuration" };
  }
  if (!authorized) {
    return { success: false, error: "Forbidden" };
  }

  try {
    await prisma.webhookConfig.update({
      where: { id: configId },
      data: { isActive },
    });
    return { success: true };
  } catch (err) {
    console.error("[webhook-config] setActive failed", err);
    return { success: false, error: "Failed to update webhook configuration" };
  }
}

export interface SendTestWebhookResult {
  ok: boolean;
  statusCode: number;
  outcome?: "synthetic" | "duplicate" | "no-link" | "updated" | "error";
  error?: string;
}

/**
 * D-20 / WARNING #8 — sends a synthetic webhook through the full pipeline self-loop.
 *
 * Replaces the previous `/api/webhooks/test` route concept. Server actions are
 * the project's idiomatic non-CRUD seam (CLAUDE.md: "Strongly prefer ZenStack
 * auto-generated hooks / server actions over creating new API endpoints").
 *
 * The browser NEVER sees the secret. The server decrypts in memory, signs the
 * SYNTHETIC_PAYLOAD literal, posts to its own `/api/webhooks/{token}`, and
 * returns ONLY `{ ok, statusCode, outcome }` to the caller.
 *
 * BLOCKER #5: SYNTHETIC_PAYLOAD is byte-identical across clicks, so two
 * consecutive calls produce: first → outcome='synthetic'; second →
 * outcome='duplicate'. SC#5 demo lock.
 */
export async function sendTestWebhook(
  configId: string
): Promise<SendTestWebhookResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { ok: false, statusCode: 401, error: "Unauthorized" };
  }

  // CR-02: read via raw prisma (the schema's @@allow('read', ...) clause is
  // bypassed here, but we authorize through `canManageWebhookConfig` below
  // before exposing anything sensitive).
  let config: { token: string; secret: string; projectId: number } | null;
  try {
    config = await prisma.webhookConfig.findUnique({
      where: { id: configId },
      select: { token: true, secret: true, projectId: true },
    });
  } catch (err) {
    console.error("[webhook-config] findUnique failed (sendTest)", err);
    return {
      ok: false,
      statusCode: 500,
      error: "Failed to load webhook configuration",
    };
  }
  if (!config) {
    return { ok: false, statusCode: 404, error: "Not found" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, config.projectId);
  } catch (err) {
    console.error("[webhook-config] auth check failed (sendTest)", err);
    return { ok: false, statusCode: 500, error: "Authorization check failed" };
  }
  if (!authorized) {
    return { ok: false, statusCode: 403, error: "Forbidden" };
  }

  let plainSecret: string;
  try {
    plainSecret = await decrypt(config.secret);
  } catch (err) {
    // CR-02 mitigation context: a project admin who bypassed the server
    // action and wrote a non-encrypted blob into `secret` would surface here.
    // After Cluster 3 CR-02 fix this becomes effectively unreachable.
    console.error("[webhook-config] decrypt failed (sendTest)", err);
    return {
      ok: false,
      statusCode: 500,
      error: "Webhook secret could not be decrypted",
    };
  }

  const sig =
    "sha256=" +
    createHmac("sha256", plainSecret).update(SYNTHETIC_PAYLOAD).digest("hex");

  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const target = `${origin}/api/webhooks/${config.token}`;

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
      },
      body: SYNTHETIC_PAYLOAD,
    });
    const upstreamBody = (await upstream.json().catch(() => ({}))) as {
      outcome?: SendTestWebhookResult["outcome"];
    };

    return {
      ok: upstream.ok,
      statusCode: upstream.status,
      outcome: upstreamBody.outcome,
    };
  } catch (err) {
    // Network/fetch failure (target unreachable, DNS, TLS, etc). The error
    // text is genuinely useful diagnostically for admins debugging connectivity
    // — keep it through to the UI (ME-02 i18n template will surface it).
    console.error("[webhook-config] fetch failed (sendTest)", err);
    return {
      ok: false,
      statusCode: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// v0.23.0 Phase 2 — outbound webhook server actions (Plan 02-06)
// =============================================================================

const DEFAULT_OUTBOUND_PRESET: string[] = [
  "test_run.completed",
  "issue.created",
];

/**
 * E2E HTTP override (Plan 02-08): when WEBHOOK_OUTBOUND_ALLOW_HTTP=true,
 * skip the HTTPS-only check on outbound URLs. Production deploys NEVER set
 * this var; it exists ONLY so the E2E can point at a local node:http stub
 * server. Documented inline rather than tucked away in env.example.
 *
 * Read at function-call time (not module load) so tests + integration
 * environments can flip the flag without re-importing.
 */
function isHttpOutboundAllowed(): boolean {
  return process.env.WEBHOOK_OUTBOUND_ALLOW_HTTP === "true";
}

export interface CreateOutboundResult {
  success: boolean;
  configId?: string;
  /** Plaintext secret — show ONCE on creation (D-06). Only set for GENERIC_HMAC. */
  secret?: string;
  error?: string;
}

/**
 * Plan 02-06 / Task 6.1 — create an OUTBOUND WebhookConfig for the project.
 *
 * Auto-detects adapterType from the URL hostname (D-29):
 *  - hooks.slack.com → SLACK   (no signing secret; URL is the credential)
 *  - everything else → GENERIC_HMAC (seeds an initial WebhookConfigSecret)
 *
 * Both `name` and `url` are persisted into the new WebhookConfig columns
 * added in Plan 02-01 (Blocker 4 fix).
 */
export async function createOutboundWebhook(input: {
  projectId: number;
  name: string;
  url: string;
  subscribedEvents?: string[];
}): Promise<CreateOutboundResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  // Blocker 4: name column is nullable on the schema for back-compat with
  // INBOUND configs that don't carry an admin label, but OUTBOUND requires
  // it per D-28. Validate trim-non-empty up front.
  const trimmedName = input.name?.trim() ?? "";
  if (trimmedName.length === 0) {
    return { success: false, error: "Name is required" };
  }

  // URL validation runs BEFORE auth so invalid input doesn't probe the
  // project-admin check (cheap-fail-first).
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url);
  } catch {
    return { success: false, error: "Invalid URL" };
  }
  if (parsedUrl.protocol !== "https:" && !isHttpOutboundAllowed()) {
    return { success: false, error: "URL must use HTTPS" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, input.projectId);
  } catch (err) {
    console.error(
      "[webhook-config] auth check failed (createOutbound)",
      err
    );
    return { success: false, error: "Failed to save webhook configuration" };
  }
  if (!authorized) {
    return { success: false, error: "Forbidden" };
  }

  const adapterType: "SLACK" | "GENERIC_HMAC" = isSlackWebhookUrl(input.url)
    ? "SLACK"
    : "GENERIC_HMAC";
  const subscribedEvents =
    input.subscribedEvents ?? DEFAULT_OUTBOUND_PRESET;
  const token = generateToken();

  if (adapterType === "SLACK") {
    // D-18: Slack URL is the credential — no HMAC signing secret needed.
    try {
      const config = await prisma.webhookConfig.create({
        data: {
          projectId: input.projectId,
          adapterType: "SLACK",
          direction: "OUTBOUND",
          token,
          secret: "", // Slack URL is the credential
          subscribedEvents,
          isActive: true,
          name: trimmedName, // Blocker 4 — Plan 02-01 column
          url: input.url, // Blocker 4 — Plan 02-01 column
        },
        select: { id: true },
      });
      return { success: true, configId: config.id };
    } catch (err) {
      console.error(
        "[webhook-config] createOutboundWebhook (Slack) failed",
        err
      );
      if (isUniqueConstraintError(err)) {
        return {
          success: false,
          error: "An outbound Slack webhook for this project already exists",
        };
      }
      return { success: false, error: "Failed to save webhook configuration" };
    }
  }

  // GENERIC_HMAC path — seed an initial WebhookConfigSecret in the same tx
  // so the dispatcher's two-secret signing has an active row from t=0.
  const plaintextSecret = generateSecret();
  let encryptedSecret: string;
  try {
    encryptedSecret = await encrypt(plaintextSecret);
  } catch (err) {
    console.error(
      "[webhook-config] encrypt failed (createOutbound HMAC)",
      err
    );
    return { success: false, error: "Failed to save webhook configuration" };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const config = await tx.webhookConfig.create({
        data: {
          projectId: input.projectId,
          adapterType: "GENERIC_HMAC",
          direction: "OUTBOUND",
          token,
          // Phase 1 column kept in sync with the active WebhookConfigSecret —
          // the rotation flow keeps this lockstep so legacy code paths that
          // read `WebhookConfig.secret` directly still see the current key.
          secret: encryptedSecret,
          subscribedEvents,
          isActive: true,
          name: trimmedName, // Blocker 4
          url: input.url, // Blocker 4
        },
        select: { id: true },
      });
      await tx.webhookConfigSecret.create({
        data: {
          webhookConfigId: config.id,
          secret: encryptedSecret,
          activatedAt: new Date(),
        },
      });
      return config;
    });
    return {
      success: true,
      configId: created.id,
      secret: plaintextSecret,
    };
  } catch (err) {
    console.error("[webhook-config] createOutboundWebhook (HMAC) failed", err);
    if (isUniqueConstraintError(err)) {
      return {
        success: false,
        error: "An outbound HMAC webhook for this project already exists",
      };
    }
    return { success: false, error: "Failed to save webhook configuration" };
  }
}

/**
 * Plan 02-06 / Task 6.1 — hard-delete an OUTBOUND webhook config.
 *
 * Cascades to WebhookDelivery + WebhookEventDedup + WebhookConfigSecret rows
 * via `onDelete: Cascade` on the FK relations.
 */
export async function deleteOutboundWebhook(
  configId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const config = await prisma.webhookConfig.findUnique({
    where: { id: configId },
    select: { projectId: true, direction: true },
  });
  if (!config) return { success: false, error: "Not found" };
  if (config.direction !== "OUTBOUND") {
    return { success: false, error: "Not an outbound webhook" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, config.projectId);
  } catch (err) {
    console.error(
      "[webhook-config] auth check failed (deleteOutbound)",
      err
    );
    return { success: false, error: "Failed to delete webhook configuration" };
  }
  if (!authorized) return { success: false, error: "Forbidden" };

  try {
    await prisma.webhookConfig.delete({ where: { id: configId } });
    return { success: true };
  } catch (err) {
    console.error("[webhook-config] deleteOutboundWebhook failed", err);
    return { success: false, error: "Failed to delete webhook configuration" };
  }
}

/**
 * Plan 02-06 / Task 6.1 — atomic update of `WebhookConfig.subscribedEvents`.
 *
 * Defensive runtime check on the array shape (matches Phase 1 pattern) — the
 * type system catches most callers but server-action arguments deserialize
 * from the wire and could in principle arrive as a non-array.
 */
export async function updateOutboundSubscriptions(
  configId: string,
  subscribedEvents: string[]
): Promise<{ success: boolean; error?: string }> {
  if (!Array.isArray(subscribedEvents)) {
    return { success: false, error: "subscribedEvents must be an array" };
  }
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const config = await prisma.webhookConfig.findUnique({
    where: { id: configId },
    select: { projectId: true, direction: true },
  });
  if (!config) return { success: false, error: "Not found" };
  if (config.direction !== "OUTBOUND") {
    return { success: false, error: "Not an outbound webhook" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, config.projectId);
  } catch {
    return { success: false, error: "Failed to update subscriptions" };
  }
  if (!authorized) return { success: false, error: "Forbidden" };

  try {
    await prisma.webhookConfig.update({
      where: { id: configId },
      data: { subscribedEvents },
    });
    return { success: true };
  } catch (err) {
    console.error("[webhook-config] updateOutboundSubscriptions failed", err);
    return { success: false, error: "Failed to update subscriptions" };
  }
}

// =============================================================================
// v0.23.0 Phase 2 / Task 6.2 — Two-secret rotation lifecycle (D-04..D-06)
// =============================================================================

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface RotateResult {
  success: boolean;
  /** Plaintext NEW secret — show ONCE on rotation (D-06). */
  secret?: string;
  error?: string;
}

/**
 * Plan 02-06 / Task 6.2 — D-04..D-06 hybrid rotation flow.
 *
 * Steady-state semantics:
 *   1. The unique current active row (`retiredAt IS NULL AND autoRetireAt IS NULL`)
 *      is demoted: `autoRetireAt = NOW() + 7d`. The dispatcher signs with both
 *      keys during the overlap window so consumers can verify with either.
 *   2. A new active row is created: `secret = enc(plaintext)`, `activatedAt = NOW()`,
 *      no autoRetireAt set.
 *   3. `WebhookConfig.secret` (Phase 1 column) is updated to the new encrypted
 *      secret so legacy read paths stay in lockstep.
 *
 * Corrupt-state branches:
 *   - Zero active rows: create new without demoting (recovery path; should
 *     never happen post-create but a corrupted seed run shouldn't brick the
 *     admin UI).
 *   - Multiple active rows: returns an error and does NOT touch any rows.
 *     Operations should run a one-off cleanup before retry.
 */
export async function rotateOutboundSecret(
  configId: string
): Promise<RotateResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const config = await prisma.webhookConfig.findUnique({
    where: { id: configId },
    select: { projectId: true, direction: true, adapterType: true },
  });
  if (!config) return { success: false, error: "Not found" };
  if (config.direction !== "OUTBOUND") {
    return { success: false, error: "Not an outbound webhook" };
  }
  if (config.adapterType === "SLACK") {
    return {
      success: false,
      error: "Slack webhooks do not have a rotatable secret",
    };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, config.projectId);
  } catch {
    return { success: false, error: "Failed to rotate secret" };
  }
  if (!authorized) return { success: false, error: "Forbidden" };

  const plaintextSecret = generateSecret();
  let encryptedSecret: string;
  try {
    encryptedSecret = await encrypt(plaintextSecret);
  } catch {
    return { success: false, error: "Failed to rotate secret" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const activeSecrets = await tx.webhookConfigSecret.findMany({
        where: {
          webhookConfigId: configId,
          retiredAt: null,
          autoRetireAt: null,
        },
        select: { id: true },
      });
      if (activeSecrets.length > 1) {
        throw new Error("MULTIPLE_ACTIVE");
      }
      // Demote the previous active (if exists). Zero-active is a recovery
      // path — proceed to create a new active without demoting.
      if (activeSecrets.length === 1) {
        await tx.webhookConfigSecret.update({
          where: { id: activeSecrets[0].id },
          data: { autoRetireAt: new Date(Date.now() + SEVEN_DAYS_MS) },
        });
      }
      await tx.webhookConfigSecret.create({
        data: {
          webhookConfigId: configId,
          secret: encryptedSecret,
          activatedAt: new Date(),
        },
      });
      // Keep the Phase 1 column in lockstep with the canonical active.
      await tx.webhookConfig.update({
        where: { id: configId },
        data: { secret: encryptedSecret },
      });
    });
    return { success: true, secret: plaintextSecret };
  } catch (err) {
    if (err instanceof Error && err.message === "MULTIPLE_ACTIVE") {
      return {
        success: false,
        error: "Multiple active secrets — contact support",
      };
    }
    console.error("[webhook-config] rotateOutboundSecret failed", err);
    return { success: false, error: "Failed to rotate secret" };
  }
}

/**
 * Plan 02-06 / Task 6.2 — manual immediate retire (admin override).
 *
 * Rejects retiring the current active row (callers must rotate first to
 * avoid bricking the dispatcher) and idempotently rejects already-retired rows.
 */
export async function retireOutboundSecretNow(
  secretId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const secret = await prisma.webhookConfigSecret.findUnique({
    where: { id: secretId },
    select: {
      retiredAt: true,
      autoRetireAt: true,
      webhookConfig: { select: { projectId: true } },
    },
  });
  if (!secret) return { success: false, error: "Not found" };
  if (secret.retiredAt) return { success: false, error: "Already retired" };
  if (secret.autoRetireAt === null) {
    return {
      success: false,
      error: "Cannot retire the active secret — rotate first",
    };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(
      session,
      secret.webhookConfig.projectId
    );
  } catch {
    return { success: false, error: "Failed to retire secret" };
  }
  if (!authorized) return { success: false, error: "Forbidden" };

  try {
    await prisma.webhookConfigSecret.update({
      where: { id: secretId },
      data: { retiredAt: new Date() },
    });
    return { success: true };
  } catch (err) {
    console.error("[webhook-config] retireOutboundSecretNow failed", err);
    return { success: false, error: "Failed to retire secret" };
  }
}

/**
 * Plan 02-06 / Task 6.2 — extend the auto-retire window by 7 more days.
 *
 * Additive: each call adds 7 days to the existing `autoRetireAt` (so a
 * second click within the window pushes it 14 days from the original
 * demotion, not 7 from "now"). This matches the admin's mental model
 * of "I need more time" without producing surprising regressions when
 * clicking late in the window.
 */
export async function extendRetiringSecret(
  secretId: string
): Promise<{ success: boolean; newAutoRetireAt?: Date; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const secret = await prisma.webhookConfigSecret.findUnique({
    where: { id: secretId },
    select: {
      retiredAt: true,
      autoRetireAt: true,
      webhookConfig: { select: { projectId: true } },
    },
  });
  if (!secret) return { success: false, error: "Not found" };
  if (secret.retiredAt) return { success: false, error: "Already retired" };
  if (secret.autoRetireAt === null) {
    return { success: false, error: "Cannot extend the active secret" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(
      session,
      secret.webhookConfig.projectId
    );
  } catch {
    return { success: false, error: "Failed to extend secret" };
  }
  if (!authorized) return { success: false, error: "Forbidden" };

  const newAutoRetireAt = new Date(
    secret.autoRetireAt.getTime() + SEVEN_DAYS_MS
  );
  try {
    await prisma.webhookConfigSecret.update({
      where: { id: secretId },
      data: { autoRetireAt: newAutoRetireAt },
    });
    return { success: true, newAutoRetireAt };
  } catch (err) {
    console.error("[webhook-config] extendRetiringSecret failed", err);
    return { success: false, error: "Failed to extend secret" };
  }
}

// =============================================================================
// v0.23.0 Phase 2 / Task 6.3 — synthetic webhook.test emission
// =============================================================================

/**
 * Plan 02-06 / Task 6.3 — fire a synthetic `webhook.test` event through the
 * full outbound pipeline.
 *
 * Architecture: this action ONLY writes the outbox row. The poller picks it
 * up async, the dispatch worker delivers it to the configured URL. The
 * subscription bypass for `webhook.test` (so the test fires regardless of
 * the admin's subscribedEvents preset) lives in `lib/webhooks/dispatch.ts`
 * (Plan 02-04 Task 4.2 / Blocker 6) — NOT here. Plan 02-06 ships only the
 * emit-side of the pipeline kick.
 *
 * The returned `eventId` is what the admin form polls against the
 * WebhookDelivery table (via the existing receivedAt/outcome columns) to
 * surface success/failure feedback in the UI.
 */
export async function sendTestOutboundWebhook(
  configId: string
): Promise<{ success: boolean; eventId?: string; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  const config = await prisma.webhookConfig.findUnique({
    where: { id: configId },
    select: { projectId: true, direction: true },
  });
  if (!config) return { success: false, error: "Not found" };
  if (config.direction !== "OUTBOUND") {
    return { success: false, error: "Not an outbound webhook" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, config.projectId);
  } catch {
    return { success: false, error: "Failed to send test webhook" };
  }
  if (!authorized) return { success: false, error: "Forbidden" };

  let eventId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const result = await webhookEvents.emit(
        "webhook.test",
        {
          source: "TestPlanIt",
          message: "Webhook pipeline is healthy",
          configId,
          dispatchedAt: new Date().toISOString(),
        },
        {
          projectId: config.projectId,
          tx,
          actorUserId: session.user.id ?? null,
        }
      );
      eventId = result?.eventId ?? null;
    });
  } catch (err) {
    console.error(
      "[webhook-config] sendTestOutboundWebhook emit failed",
      err
    );
    return { success: false, error: "Failed to send test webhook" };
  }
  return { success: true, eventId: eventId ?? undefined };
}
