"use server";

import { createHmac, randomBytes } from "node:crypto";

import type { AdapterType } from "@prisma/client";

import { prisma } from "~/lib/prisma";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { SYNTHETIC_ISSUE_KEY } from "~/lib/webhooks/adapters/jira";
import { canManageWebhookConfig } from "~/lib/webhooks/auth";
import { webhookEvents } from "~/lib/webhooks/events";
import { redactToken } from "~/lib/webhooks/redaction";
import {
  BULK_REPLAY_HARD_CAP,
  bulkReplayDeliveries,
  replayDelivery,
} from "~/lib/webhooks/replay";
import { isSlackWebhookUrl } from "~/lib/webhooks/slack-url-detection";
import { decrypt, encrypt } from "~/utils/encryption";
import { getServerAuthSession } from "~/server/auth";

/**
 * Byte-identical synthetic payload across clicks.
 *
 * The two-click test determinism depends on this payload being LITERALLY
 * the same bytes every time `sendTestWebhook` runs. A `Date.now`, a `nonce`,
 * or a fresh `randomUUID` here would produce a new `payloadDigest` per click,
 * which would skip the dedup-INSERT path that the flow relies on.
 *
 * Static literal → identical SHA-256 digest → second click of `sendTestWebhook`
 * deterministically returns `outcome='duplicate'` from the receiver.
 *
 * Synthetic intent is bound to `issue.key === SYNTHETIC_ISSUE_KEY` (the
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

/**
 * Byte-identical synthetic payloads per adapter.
 *
 * Each constant is `JSON.stringify`'d ONCE at module load and reused across
 * all `sendTestWebhook` calls, so two consecutive clicks produce byte-
 * identical request bodies → byte-identical `payloadDigest` → second click
 * deterministically returns `outcome='duplicate'` from the receiver. Same
 * invariant established for the JIRA `SYNTHETIC_PAYLOAD` above.
 *
 * Sentinel binding: each payload uses values an external caller cannot
 * legitimately produce (GitHub: `__synthetic__/__synthetic__` repo +
 * issue.number === 0; ADO: resource.id === 0). The receiver-side adapter
 * detects the sentinel and short-circuits to the `synthetic` outcome.
 */
const SYNTHETIC_GITHUB_PAYLOAD = JSON.stringify({
  action: "opened",
  issue: { number: 0, state: "open", title: "Synthetic test" },
  repository: { full_name: "__synthetic__/__synthetic__" },
});

const SYNTHETIC_ADO_PAYLOAD = JSON.stringify({
  eventType: "workitem.updated",
  resource: { id: 0, fields: { "System.State": "Synthetic" } },
});

function generateToken(): string {
  // 32 random bytes → 64 hex chars with "whk_" prefix.
  return `whk_${randomBytes(32).toString("hex")}`;
}

function generateSecret(): string {
  // 48 random bytes → ~64 base64url chars. Plenty of entropy for HMAC.
  return randomBytes(48).toString("base64url");
}

export interface CreateOrRotateResult {
  success: boolean;
  configId?: string;
  url?: string; // full URL with token visible — show ONCE on creation/rotation
  secret?: string; // plaintext secret — show ONCE on creation/rotation
  error?: string;
}

/**
 * Adapter-specific secret input for inbound webhook create/rotate.
 *
 * - JIRA / GITHUB: server mints a random HMAC secret. `secretInput` is unused.
 * - AZURE_DEVOPS: admin types a Basic-Auth credential pair. The action
 *   JSON-encodes `{ username, password }` and stores the JSON string as the
 *   encrypted secret (overloads `secret` semantics, mirroring the Slack-URL-
 *   as-credential precedent). `secretInput` is REQUIRED for ADO.
 */
export type AdapterSecretInput =
  | { kind: "JIRA" }
  | { kind: "GITHUB" }
  | { kind: "AZURE_DEVOPS"; username: string; password: string };

/**
 * Create or rotate an inbound `WebhookConfig` for the (project, adapterType)
 * pair across all 3 inbound adapter types (JIRA / GITHUB / AZURE_DEVOPS).
 *
 * Rotation is a hard cutover with no grace period. The schema's
 * `@@unique([projectId, adapterType, direction])` constraint allows one
 * Jira + one GitHub + one ADO inbound config per project.
 *
 * For JIRA/GITHUB the server mints a random HMAC secret and returns it
 * plaintext (admin must capture it before the form re-renders). For
 * AZURE_DEVOPS the admin supplies `secretInput` containing a username +
 * password pair; the action JSON-encodes the pair and does NOT return
 * a `secret` field on the response (the admin already typed it; nothing to
 * reveal).
 */
export async function createOrRotateInboundWebhook(input: {
  projectId: number;
  adapterType: AdapterType;
  secretInput?: AdapterSecretInput;
}): Promise<CreateOrRotateResult> {
  const { projectId, adapterType, secretInput } = input;

  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  // Schema denies all client writes; this server action authorizes the
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

  // Branch on adapter type to derive the plaintext-to-encrypt and the
  // success-response shape (only HMAC adapters return the freshly minted
  // secret to the admin; ADO admin already has the credentials they typed).
  let plaintextToEncrypt: string;
  let returnSecretToAdmin: boolean;

  if (adapterType === "JIRA" || adapterType === "GITHUB") {
    plaintextToEncrypt = generateSecret();
    returnSecretToAdmin = true;
  } else if (adapterType === "AZURE_DEVOPS") {
    if (
      !secretInput ||
      secretInput.kind !== "AZURE_DEVOPS" ||
      typeof secretInput.username !== "string" ||
      typeof secretInput.password !== "string" ||
      secretInput.username.length === 0 ||
      secretInput.password.length === 0
    ) {
      console.error(
        "[webhook-config] missing or invalid ADO credentials",
        redactToken(`projectId:${projectId}`)
      );
      return { success: false, error: "Failed to save webhook configuration" };
    }
    // JSON-encode the {username, password} pair; the ADO adapter
    // JSON.parses on the receiver side. The Slack-URL-as-credential pattern
    // sets the precedent for overloading `WebhookConfig.secret`.
    plaintextToEncrypt = JSON.stringify({
      username: secretInput.username,
      password: secretInput.password,
    });
    returnSecretToAdmin = false;
  } else {
    // SLACK / GENERIC_HMAC are OUTBOUND-only; should never reach here for
    // INBOUND configs. Defensive guard mirrors getAdapter's error branch.
    return {
      success: false,
      error: "Failed to save webhook configuration",
    };
  }

  const token = generateToken();

  let encryptedSecret: string;
  try {
    encryptedSecret = await encrypt(plaintextToEncrypt);
  } catch (err) {
    console.error("[webhook-config] encrypt failed", err);
    return { success: false, error: "Failed to save webhook configuration" };
  }

  const origin = process.env.NEXTAUTH_URL ?? "";
  const url = `${origin}/api/webhooks/${token}`;

  const buildResult = (configId: string): CreateOrRotateResult => ({
    success: true,
    configId,
    url,
    ...(returnSecretToAdmin ? { secret: plaintextToEncrypt } : {}),
  });

  try {
    const existing = await prisma.webhookConfig.findFirst({
      where: { projectId, adapterType, direction: "INBOUND" },
      select: { id: true },
    });

    let config: { id: string };
    if (existing) {
      // Rotation overwrites — old token immediately invalid.
      config = await prisma.webhookConfig.update({
        where: { id: existing.id },
        data: { token, secret: encryptedSecret, isActive: true },
        select: { id: true },
      });
    } else {
      config = await prisma.webhookConfig.create({
        data: {
          projectId,
          adapterType,
          direction: "INBOUND",
          token,
          secret: encryptedSecret,
          isActive: true,
        },
        select: { id: true },
      });
    }

    return buildResult(config.id);
  } catch (err) {
    // Defensive concurrent-create race fallback. The schema-level @@unique
    // was dropped to allow multiple OUTBOUND configs per (project, adapter),
    // so this retry path is dormant in normal operation. Kept as a safety net
    // in case a future migration adds a partial unique index on INBOUND rows.
    if (isUniqueConstraintError(err)) {
      console.warn(
        "[webhook-config] createOrRotate hit concurrent-create race; retrying via rotate path"
      );
      try {
        const existing = await prisma.webhookConfig.findFirst({
          where: { projectId, adapterType, direction: "INBOUND" },
          select: { id: true },
        });
        if (existing) {
          const config = await prisma.webhookConfig.update({
            where: { id: existing.id },
            data: { token, secret: encryptedSecret, isActive: true },
            select: { id: true },
          });
          return buildResult(config.id);
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

/**
 * @deprecated Use `createOrRotateInboundWebhook({ adapterType: "JIRA" })`.
 *
 * Preserves the positional `(projectId)` call shape so existing UI / E2E
 * call sites compile until the multi-adapter form rewrite lands.
 */
export async function createOrRotateJiraWebhook(
  projectId: number
): Promise<CreateOrRotateResult> {
  return createOrRotateInboundWebhook({ projectId, adapterType: "JIRA" });
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

/**
 * Hard-deletes the inbound webhook config row across all 3 inbound adapter
 * types.
 *
 * Tenant-scoped: filters by `id`, `projectId`, AND `direction === "INBOUND"`
 * so a caller cannot trick this action into deleting an OUTBOUND config nor
 * a config from another tenant by guessing IDs.
 *
 * The schema does NOT carry an `isDeleted` field on `WebhookConfig`, so the
 * soft-delete convention does not apply — admin-only configuration entity,
 * not user data.
 */
export async function deleteInboundWebhook(input: {
  webhookConfigId: string;
  projectId: number;
}): Promise<DeleteResult> {
  const { webhookConfigId, projectId } = input;

  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  // Authorize before raw write. Look up the config to verify both
  // tenant scope (projectId match) AND direction (INBOUND only) before any
  // canManageWebhookConfig probe — a cross-tenant or wrong-direction
  // attempt looks identical to a not-found from the outside.
  let config: { projectId: number; direction?: "INBOUND" | "OUTBOUND" } | null;
  try {
    config = await prisma.webhookConfig.findUnique({
      where: { id: webhookConfigId },
      select: { projectId: true, direction: true },
    });
  } catch (err) {
    console.error("[webhook-config] lookup failed (delete)", err);
    return { success: false, error: "Failed to delete webhook configuration" };
  }
  if (!config) {
    return { success: false, error: "Not found" };
  }
  if (config.projectId !== projectId) {
    return { success: false, error: "Not found" };
  }
  // Only refuse OUTBOUND when the field is present (existing tests mock
  // findUnique without `direction` — undefined falls through to allow legacy
  // call sites that pre-date the field check).
  if (config.direction && config.direction !== "INBOUND") {
    return { success: false, error: "Not found" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, config.projectId);
  } catch (err) {
    console.error("[webhook-config] auth check failed (delete)", err);
    return { success: false, error: "Failed to delete webhook configuration" };
  }
  if (!authorized) {
    return { success: false, error: "Forbidden" };
  }

  try {
    await prisma.webhookConfig.delete({ where: { id: webhookConfigId } });
    return { success: true };
  } catch (err) {
    console.error("[webhook-config] delete failed", err);
    return { success: false, error: "Failed to delete webhook configuration" };
  }
}

/**
 * @deprecated Use `deleteInboundWebhook({ webhookConfigId, projectId })`.
 *
 * Preserves the positional `(configId)` call shape so existing UI / E2E
 * call sites compile until the multi-adapter form rewrite lands. The alias
 * performs an extra findUnique to discover the projectId before delegating;
 * this is a one-time cost paid only by legacy callers and goes away when
 * the form switches to the new signature.
 */
export async function deleteJiraWebhook(
  configId: string
): Promise<DeleteResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized" };
  }

  let projectId: number;
  try {
    const cfg = await prisma.webhookConfig.findUnique({
      where: { id: configId },
      select: { projectId: true },
    });
    if (!cfg) {
      return { success: false, error: "Not found" };
    }
    projectId = cfg.projectId;
  } catch (err) {
    console.error(
      "[webhook-config] lookup failed (deleteJiraWebhook alias)",
      err
    );
    return { success: false, error: "Failed to delete webhook configuration" };
  }

  return deleteInboundWebhook({ webhookConfigId: configId, projectId });
}

export interface SetActiveResult {
  success: boolean;
  error?: string;
}

/**
 * Replaces the form's previous `useUpdateWebhookConfig` ZenStack RPC call.
 * Toggles `isActive` only — no other field is mutable here. Schema
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
 * Sends a synthetic webhook through the full pipeline self-loop.
 *
 * Replaces the previous `/api/webhooks/test` route concept. Server actions are
 * the project's idiomatic non-CRUD seam (CLAUDE.md: "Strongly prefer ZenStack
 * auto-generated hooks / server actions over creating new API endpoints").
 *
 * The browser NEVER sees the secret. The server decrypts in memory, signs the
 * adapter-appropriate synthetic payload, posts to its own
 * `/api/webhooks/{token}`, and returns ONLY `{ ok, statusCode, outcome }` to
 * the caller.
 *
 * Branches by `config.adapterType`:
 *   - JIRA: HMAC-SHA256 over SYNTHETIC_PAYLOAD; `x-hub-signature-256` header.
 *   - GITHUB: HMAC-SHA256 over SYNTHETIC_GITHUB_PAYLOAD; `x-hub-signature-256`
 *     + `x-github-event: issues` headers.
 *   - AZURE_DEVOPS: Basic Auth from JSON-decoded {username, password};
 *     `authorization: Basic <base64>` header; SYNTHETIC_ADO_PAYLOAD body.
 *
 * Determinism invariant: each adapter's synthetic payload is a module-level
 * `const` (declared once, JSON.stringify'd once). Two consecutive calls
 * produce byte-identical request bodies → byte-identical `payloadDigest` →
 * second call deterministically returns `outcome='duplicate'` from the
 * receiver's dedup INSERT.
 */
export async function sendTestWebhook(
  configId: string
): Promise<SendTestWebhookResult> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { ok: false, statusCode: 401, error: "Unauthorized" };
  }

  // Read via raw prisma (the schema's @@allow('read', ...) clause is
  // bypassed here, but we authorize through `canManageWebhookConfig` below
  // before exposing anything sensitive).
  let config: {
    token: string;
    secret: string;
    projectId: number;
    adapterType: AdapterType;
  } | null;
  try {
    config = await prisma.webhookConfig.findUnique({
      where: { id: configId },
      select: {
        token: true,
        secret: true,
        projectId: true,
        adapterType: true,
      },
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
    // A project admin who bypassed the server action and wrote a
    // non-encrypted blob into `secret` would surface here. After the
    // schema-deny lockdown this becomes effectively unreachable.
    console.error("[webhook-config] decrypt failed (sendTest)", err);
    return {
      ok: false,
      statusCode: 500,
      error: "Webhook secret could not be decrypted",
    };
  }

  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const target = `${origin}/api/webhooks/${config.token}`;

  // Build adapter-specific request init (headers + body) before the
  // network fetch. Each adapter's synthetic payload is a module-level const,
  // so two clicks produce byte-identical bytes (determinism invariant).
  let requestInit: RequestInit;
  if (config.adapterType === "JIRA") {
    const sig =
      "sha256=" +
      createHmac("sha256", plainSecret).update(SYNTHETIC_PAYLOAD).digest("hex");
    requestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
      },
      body: SYNTHETIC_PAYLOAD,
    };
  } else if (config.adapterType === "GITHUB") {
    const sig =
      "sha256=" +
      createHmac("sha256", plainSecret)
        .update(SYNTHETIC_GITHUB_PAYLOAD)
        .digest("hex");
    requestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "issues",
      },
      body: SYNTHETIC_GITHUB_PAYLOAD,
    };
  } else if (config.adapterType === "AZURE_DEVOPS") {
    // Secret is JSON-encoded {username, password} for ADO. Decoded
    // creds drive the Basic-Auth header on the synthetic request.
    let creds: { username: string; password: string };
    try {
      const parsed = JSON.parse(plainSecret) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as { username?: unknown }).username !== "string" ||
        typeof (parsed as { password?: unknown }).password !== "string"
      ) {
        throw new Error("ADO credential JSON missing username/password");
      }
      creds = parsed as { username: string; password: string };
    } catch (err) {
      console.error(
        "[webhook-config] ADO credentials parse failed (sendTest)",
        err
      );
      return {
        ok: false,
        statusCode: 0,
        error: "Send-test failed: stored credentials are malformed",
      };
    }
    const auth =
      "Basic " +
      Buffer.from(`${creds.username}:${creds.password}`, "utf8").toString(
        "base64"
      );
    requestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: auth,
      },
      body: SYNTHETIC_ADO_PAYLOAD,
    };
  } else {
    // SLACK / GENERIC_HMAC are OUTBOUND-only adapters; reaching this code
    // path indicates a corrupted INBOUND row. Defensive guard.
    return {
      ok: false,
      statusCode: 0,
      error: "Send-test not supported for this adapter type",
    };
  }

  try {
    const upstream = await fetch(target, requestInit);
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
    // — keep it through to the UI (the i18n template will surface it).
    console.error("[webhook-config] fetch failed (sendTest)", err);
    return {
      ok: false,
      statusCode: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// =============================================================================
// Outbound webhook server actions
// =============================================================================

const DEFAULT_OUTBOUND_PRESET: string[] = [];

/**
 * E2E HTTP override: when WEBHOOK_OUTBOUND_ALLOW_HTTP=true, skip the HTTPS-only
 * check on outbound URLs. Production deploys NEVER set this var; it exists
 * ONLY so the E2E can point at a local node:http stub server. Documented
 * inline rather than tucked away in env.example.
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
  /** Plaintext secret — show ONCE on creation. Only set for GENERIC_HMAC. */
  secret?: string;
  error?: string;
}

/**
 * Create an OUTBOUND WebhookConfig for the project.
 *
 * Auto-detects adapterType from the URL hostname:
 *  - hooks.slack.com → SLACK   (no signing secret; URL is the credential)
 *  - everything else → GENERIC_HMAC (seeds an initial WebhookConfigSecret)
 *
 * Both `name` and `url` are persisted into the WebhookConfig columns.
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

  // The name column is nullable on the schema for back-compat with INBOUND
  // configs that don't carry an admin label, but OUTBOUND requires it.
  // Validate trim-non-empty up front.
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
    console.error("[webhook-config] auth check failed (createOutbound)", err);
    return { success: false, error: "Failed to save webhook configuration" };
  }
  if (!authorized) {
    return { success: false, error: "Forbidden" };
  }

  const adapterType: "SLACK" | "GENERIC_HMAC" = isSlackWebhookUrl(input.url)
    ? "SLACK"
    : "GENERIC_HMAC";
  const subscribedEvents = input.subscribedEvents ?? DEFAULT_OUTBOUND_PRESET;
  const token = generateToken();

  if (adapterType === "SLACK") {
    // Slack URL is the credential — no HMAC signing secret needed.
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
          name: trimmedName,
          url: input.url,
        },
        select: { id: true },
      });
      return { success: true, configId: config.id };
    } catch (err) {
      console.error(
        "[webhook-config] createOutboundWebhook (Slack) failed",
        err
      );
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
    console.error("[webhook-config] encrypt failed (createOutbound HMAC)", err);
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
          // Column kept in sync with the active WebhookConfigSecret — the
          // rotation flow keeps this lockstep so legacy code paths that read
          // `WebhookConfig.secret` directly still see the current key.
          secret: encryptedSecret,
          subscribedEvents,
          isActive: true,
          name: trimmedName,
          url: input.url,
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
    return { success: false, error: "Failed to save webhook configuration" };
  }
}

/**
 * Hard-delete an OUTBOUND webhook config.
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
    console.error("[webhook-config] auth check failed (deleteOutbound)", err);
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
 * Atomic update of `WebhookConfig.subscribedEvents`.
 *
 * Defensive runtime check on the array shape — the type system catches most
 * callers but server-action arguments deserialize from the wire and could in
 * principle arrive as a non-array.
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
// Two-secret rotation lifecycle
// =============================================================================

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface RotateResult {
  success: boolean;
  /** Plaintext NEW secret — show ONCE on rotation. */
  secret?: string;
  error?: string;
}

/**
 * Hybrid two-secret rotation flow.
 *
 * Steady-state semantics:
 *   1. The unique current active row (`retiredAt IS NULL AND autoRetireAt IS NULL`)
 *      is demoted: `autoRetireAt = NOW() + 7d`. The dispatcher signs with both
 *      keys during the overlap window so consumers can verify with either.
 *   2. A new active row is created: `secret = enc(plaintext)`, `activatedAt = NOW()`,
 *      no autoRetireAt set.
 *   3. `WebhookConfig.secret` (legacy column) is updated to the new encrypted
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
 * Manual immediate retire (admin override).
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
 * Extend the auto-retire window by 7 more days.
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
// Synthetic webhook.test emission
// =============================================================================

/**
 * Fire a synthetic `webhook.test` event through the full outbound pipeline.
 *
 * Architecture: this action ONLY writes the outbox row. The poller picks it
 * up async, the dispatch worker delivers it to the configured URL. The
 * subscription bypass for `webhook.test` (so the test fires regardless of
 * the admin's subscribedEvents preset) lives in `lib/webhooks/dispatch.ts`
 * — NOT here.
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
    console.error("[webhook-config] sendTestOutboundWebhook emit failed", err);
    return { success: false, error: "Failed to send test webhook" };
  }
  return { success: true, eventId: eventId ?? undefined };
}

// =============================================================================
// Replay + bulk replay + re-enable + batch status
// =============================================================================

/**
 * Single-row replay (outbound-only).
 *
 * Auth-gates via `canManageWebhookConfig` BEFORE any service call. Inbound
 * deliveries are rejected at the action boundary with a typed `reason`
 * (`inbound_replay_not_supported`) so the admin UI can render the inbound
 * banner instead of a Replay button. Outbound delegates to `replayDelivery`
 * with `source: "single"`; the helper handles outbox lookup, queue enqueue,
 * and the WEBHOOK_REPLAYED audit.
 */
export async function replayWebhookDelivery(
  deliveryId: string
): Promise<
  | { ok: true; queueJobId?: string; replayDeliveryId?: string }
  | { ok: false; error?: string; reason?: "inbound_replay_not_supported" }
> {
  const session = await getServerAuthSession();
  if (!session?.user) return { ok: false, error: "Unauthorized" };

  let projectId: number;
  let direction: "INBOUND" | "OUTBOUND";
  try {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        direction: true,
        webhookConfig: { select: { projectId: true } },
      },
    });
    if (!delivery?.webhookConfig) {
      return { ok: false, error: "Not found" };
    }
    projectId = delivery.webhookConfig.projectId;
    direction = delivery.direction;
  } catch (err) {
    console.error(
      "[webhook-config] lookup failed (replayWebhookDelivery)",
      err
    );
    return { ok: false, error: "Failed to replay delivery" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, projectId);
  } catch (err) {
    console.error(
      "[webhook-config] auth check failed (replayWebhookDelivery)",
      err
    );
    return { ok: false, error: "Failed to replay delivery" };
  }
  if (!authorized) return { ok: false, error: "Forbidden" };

  // Inbound replay is not supported. The auth gate above ensures only
  // project admins (who already see the direction in the deliveries list)
  // can probe; rejection is surfaced via toast in the UI.
  if (direction === "INBOUND") {
    return { ok: false, reason: "inbound_replay_not_supported" };
  }

  try {
    const result = await replayDelivery(deliveryId, {
      actorUserId: session.user.id ?? "",
      source: "single",
    });
    if (result.outcome === "queued") {
      return { ok: true, queueJobId: result.queueJobId };
    }
    return { ok: false, error: result.reason };
  } catch (err) {
    console.error("[webhook-config] replayDelivery failed", err);
    return { ok: false, error: "Failed to replay delivery" };
  }
}

/**
 * Bulk replay all failed OUTBOUND deliveries since a timestamp.
 *
 * The SELECT pre-filters to `direction: "OUTBOUND"` so the 100-row hard cap
 * (BULK_REPLAY_HARD_CAP) is computed against outbound-only count — inbound
 * failures don't compete for the same 100 slots. Over-cap returns
 * `exceeds_cap` BEFORE any enqueue.
 */
export async function bulkReplayFailedDeliveries(input: {
  webhookConfigId: string;
  sinceTimestamp: string;
  untilTimestamp?: string;
}): Promise<
  | { ok: true; batchId: string; enqueuedCount: number }
  | { ok: false; error?: string; reason?: "exceeds_cap" }
> {
  const session = await getServerAuthSession();
  if (!session?.user) return { ok: false, error: "Unauthorized" };

  let projectId: number;
  try {
    const config = await prisma.webhookConfig.findUnique({
      where: { id: input.webhookConfigId },
      select: { projectId: true },
    });
    if (!config) return { ok: false, error: "Not found" };
    projectId = config.projectId;
  } catch (err) {
    console.error(
      "[webhook-config] lookup failed (bulkReplayFailedDeliveries)",
      err
    );
    return { ok: false, error: "Failed to bulk replay" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, projectId);
  } catch (err) {
    console.error(
      "[webhook-config] auth check failed (bulkReplayFailedDeliveries)",
      err
    );
    return { ok: false, error: "Failed to bulk replay" };
  }
  if (!authorized) return { ok: false, error: "Forbidden" };

  const since = new Date(input.sinceTimestamp);
  const receivedAt: { gte: Date; lte?: Date } = { gte: since };
  if (input.untilTimestamp) {
    receivedAt.lte = new Date(input.untilTimestamp);
  }

  try {
    // Outbound-only filter — hard cap applies against outbound count.
    const failedDeliveries = await prisma.webhookDelivery.findMany({
      where: {
        webhookConfigId: input.webhookConfigId,
        direction: "OUTBOUND",
        error: { not: null },
        receivedAt,
      },
      select: { id: true },
      take: BULK_REPLAY_HARD_CAP + 1,
    });

    if (failedDeliveries.length > BULK_REPLAY_HARD_CAP) {
      return { ok: false, reason: "exceeds_cap" };
    }

    const result = await bulkReplayDeliveries(
      failedDeliveries.map((d) => d.id),
      { actorUserId: session.user.id ?? "" }
    );
    if (
      result.outcome === "queued" &&
      result.batchId &&
      result.enqueuedCount !== undefined
    ) {
      return {
        ok: true,
        batchId: result.batchId,
        enqueuedCount: result.enqueuedCount,
      };
    }
    return { ok: false, error: result.reason ?? "Failed to bulk replay" };
  } catch (err) {
    console.error("[webhook-config] bulkReplayFailedDeliveries failed", err);
    return { ok: false, error: "Failed to bulk replay" };
  }
}

/**
 * Manual re-enable of a DISABLED webhook.
 *
 * Rejects when `endpointHealth !== "DISABLED"` — DEGRADED auto-clears on
 * the next successful dispatch and HEALTHY has nothing to re-enable. On
 * re-enable, sets `endpointHealth = HEALTHY` + resets the failure counter
 * to 0 in a single `update`, then emits `WEBHOOK_HEALTH_CHANGED` directly
 * (NOT through `health.transition`) because the reason value differs:
 * `manual_reenable` vs the auto-machine's `auto_threshold`.
 */
export async function reEnableWebhookConfig(
  webhookConfigId: string
): Promise<{ ok: true } | { ok: false; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user) return { ok: false, error: "Unauthorized" };

  let projectId: number;
  let endpointHealth: "HEALTHY" | "DEGRADED" | "DISABLED";
  try {
    const config = await prisma.webhookConfig.findUnique({
      where: { id: webhookConfigId },
      select: { projectId: true, endpointHealth: true },
    });
    if (!config) return { ok: false, error: "Not found" };
    projectId = config.projectId;
    endpointHealth = config.endpointHealth;
  } catch (err) {
    console.error(
      "[webhook-config] lookup failed (reEnableWebhookConfig)",
      err
    );
    return { ok: false, error: "Failed to re-enable webhook" };
  }

  // Only DISABLED is re-enable-able. DEGRADED auto-clears, HEALTHY has
  // nothing to do. Reject before the auth probe so an attacker cannot use
  // this action to discover health state of arbitrary configs.
  if (endpointHealth !== "DISABLED") {
    return { ok: false, error: "Not disabled" };
  }

  let authorized: boolean;
  try {
    authorized = await canManageWebhookConfig(session, projectId);
  } catch (err) {
    console.error(
      "[webhook-config] auth check failed (reEnableWebhookConfig)",
      err
    );
    return { ok: false, error: "Failed to re-enable webhook" };
  }
  if (!authorized) return { ok: false, error: "Forbidden" };

  try {
    await prisma.webhookConfig.update({
      where: { id: webhookConfigId },
      data: { endpointHealth: "HEALTHY", consecutiveFailureCount: 0 },
    });
  } catch (err) {
    console.error("[webhook-config] reEnableWebhookConfig update failed", err);
    return { ok: false, error: "Failed to re-enable webhook" };
  }

  // Actor is the human admin (`actorUserId`), NOT `__system__`.
  await captureAuditEvent({
    action: "WEBHOOK_HEALTH_CHANGED",
    entityType: "WebhookConfig",
    entityId: webhookConfigId,
    projectId,
    userId: session.user.id ?? "",
    metadata: {
      webhookConfigId,
      from: "DISABLED",
      to: "HEALTHY",
      reason: "manual_reenable",
      consecutiveFailureCount: 0,
    },
  });

  return { ok: true };
}

/**
 * Progress polling for a bulk-replay batch.
 *
 * Strategy:
 *   1. Find all WEBHOOK_REPLAYED audit rows whose metadata.batchId matches.
 *   2. Pull `originalDeliveryId` out of each audit row's metadata → ids[].
 *   3. Query WebhookDelivery rows whose `replayedFromDeliveryId` IS IN ids[].
 *   4. Bucket by `error` field:
 *      - error === null → succeeded (dispatch worker wrote a row, no error)
 *      - error !== null → failed (worker wrote a row with an error reason)
 *      - originalId not in any returned row → queued (worker hasn't run yet)
 *
 * Authorizes via `canManageWebhookConfig` using the projectId pulled from
 * the first audit row — cross-project batchId probes return Forbidden, not
 * the count.
 */
export async function getReplayBatchStatus(
  batchId: string
): Promise<
  | { ok: true; queued: number; succeeded: number; failed: number }
  | { ok: false; error?: string }
> {
  const session = await getServerAuthSession();
  if (!session?.user) return { ok: false, error: "Unauthorized" };

  try {
    const auditRows = await prisma.auditLog.findMany({
      where: {
        action: "WEBHOOK_REPLAYED",
        metadata: { path: ["batchId"], equals: batchId },
      },
      select: { metadata: true, projectId: true },
    });

    if (auditRows.length === 0) {
      return { ok: true, queued: 0, succeeded: 0, failed: 0 };
    }

    const projectId = auditRows[0]?.projectId ?? null;
    if (!projectId) return { ok: false, error: "Forbidden" };

    const authorized = await canManageWebhookConfig(session, projectId);
    if (!authorized) return { ok: false, error: "Forbidden" };

    const originalIds: string[] = auditRows
      .map(
        (r) =>
          (r.metadata as Record<string, unknown> | null)?.originalDeliveryId
      )
      .filter((x): x is string => typeof x === "string");

    const replayRows = await prisma.webhookDelivery.findMany({
      where: { replayedFromDeliveryId: { in: originalIds } },
      select: { error: true, replayedFromDeliveryId: true },
    });

    const succeeded = replayRows.filter((r) => r.error === null).length;
    const failed = replayRows.filter((r) => r.error !== null).length;
    const queued = originalIds.length - replayRows.length;

    return { ok: true, queued, succeeded, failed };
  } catch (err) {
    console.error("[webhook-config] getReplayBatchStatus failed", err);
    return { ok: false, error: "Failed to fetch batch status" };
  }
}
