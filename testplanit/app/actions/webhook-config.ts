"use server";

import { createHmac, randomBytes } from "node:crypto";

import { prisma } from "~/lib/prisma";
import { canManageWebhookConfig } from "~/lib/webhooks/auth";
import { decrypt, encrypt } from "~/utils/encryption";
import { getServerAuthSession } from "~/server/auth";

/**
 * D-20 / BLOCKER #5 — byte-identical synthetic payload across clicks.
 *
 * The two-click SC#5 demo determinism depends on this payload being LITERALLY
 * the same bytes every time `sendTestWebhook` runs. A `Date.now`, a `nonce`,
 * or a fresh `randomUUID` here would produce a new `payloadDigest` per click,
 * which would skip the dedup-INSERT P2002 path that the demo relies on.
 *
 * Static literal → identical SHA-256 digest → second click of `sendTestWebhook`
 * deterministically returns `outcome='duplicate'` from the receiver. SC#5 demo lock.
 *
 * `metadata.synthetic === true` is the D-20 sentinel that plan 01-03's sync
 * service uses to short-circuit BEFORE touching any production Issue.
 */
const SYNTHETIC_PAYLOAD = JSON.stringify({
  webhookEvent: "jira:issue_updated",
  issue: {
    key: "FAKE-9999",
    fields: { status: { name: "Synthetic Test" } },
  },
  metadata: { synthetic: true },
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
    // Friendly error to client, raw error logged server-side (LO-04). Includes
    // the create-race case (concurrent admins both creating) which surfaces as
    // P2002 on the (projectId, adapterType, direction) unique constraint —
    // see ME-03 for retry-with-update follow-up; for now a friendly message.
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
