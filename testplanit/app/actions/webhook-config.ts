"use server";

import { createHmac, randomBytes } from "node:crypto";

import { getEnhancedDb } from "~/lib/auth/utils";
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

  let db;
  try {
    db = await getEnhancedDb(session);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const token = generateToken();
  const plaintextSecret = generateSecret();
  const encryptedSecret = await encrypt(plaintextSecret);

  const origin = process.env.NEXTAUTH_URL ?? "";
  const url = `${origin}/api/webhooks/${token}`;

  try {
    const existing = await db.webhookConfig.findFirst({
      where: { projectId, adapterType: "JIRA", direction: "INBOUND" },
      select: { id: true },
    });

    let config: { id: string };
    if (existing) {
      // D-07: rotation overwrites — old token immediately invalid.
      config = await db.webhookConfig.update({
        where: { id: existing.id },
        data: { token, secret: encryptedSecret, isActive: true },
        select: { id: true },
      });
    } else {
      config = await db.webhookConfig.create({
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
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
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

  let db;
  try {
    db = await getEnhancedDb(session);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await db.webhookConfig.delete({ where: { id: configId } });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
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

  let db;
  try {
    db = await getEnhancedDb(session);
  } catch (err) {
    return {
      ok: false,
      statusCode: 401,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const config = await db.webhookConfig.findUnique({
    where: { id: configId },
    select: { token: true, secret: true, projectId: true },
  });
  if (!config) {
    return { ok: false, statusCode: 404, error: "Not found" };
  }

  const plainSecret = await decrypt(config.secret);
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
    return {
      ok: false,
      statusCode: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
