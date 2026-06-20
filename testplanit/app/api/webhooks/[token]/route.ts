import { createHash } from "node:crypto";
import type { AdapterType } from "~/zenstack/models";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { withAuditContext } from "~/lib/auditContextWrappers";
import { prisma } from "~/lib/prisma";
import { getAdapter } from "~/lib/webhooks/adapters";
import type { VerifyResult } from "~/lib/webhooks/adapters/types";
import { redactToken } from "~/lib/webhooks/redaction";
import { applyInboundIssueUpdate } from "~/lib/webhooks/services/applyInboundIssueUpdate";
import { decrypt } from "~/utils/encryption";

/**
 * Inbound webhook receiver — opaque-token routing.
 *
 * Token = the routing/lookup key (public-but-secret string in the URL).
 * Secret = the HMAC verification key (separate field, encrypted at rest).
 *
 * Failure-mode posture:
 *   - Unknown token       → 404 { ok: false }, no DB writes, no audit
 *   - Inactive config     → 404 (same body as unknown — callers can't enumerate)
 *   - HMAC fail           → 401 { ok: false }, no DB writes, no audit
 *   - Service error       → 500 { ok: false } (server-side log only, token redacted)
 *   - All success outcomes (updated / no-link / duplicate / synthetic) → 200,
 *     since Jira does not retry 2xx responses.
 *
 * Registry dispatch via getAdapter — the receiver never branches on the
 * adapter discriminator inline. The route file holds zero Jira-specific logic.
 *
 * Logging note: the codebase has no structured logger today; we use
 * console.{warn,error} with token-redacted strings. Promotion to Pino with a
 * redaction config is a captured follow-up.
 */
/**
 * Maximum body size accepted by the receiver. Real Jira webhook payloads cap
 * around 50 KiB; GitHub caps inbound deliveries at 25 MiB, ADO at ~25 KiB. The
 * 5 MB ceiling gives comfortable headroom over Jira/ADO with a generous-but-
 * bounded safety margin for GitHub `issues` events on long-bodied issues,
 * while preventing unauthenticated callers from buffering multi-GB POSTs and
 * OOM'ing the pod before token/HMAC validation can short-circuit them.
 * Next.js App Router has no default body-size limit on raw route handlers
 * (the `serverActions` `bodySizeLimit` config does NOT apply here).
 */
const MAX_WEBHOOK_BYTES = 5_242_880;

/**
 * The webhook receiver runs without a user session — `__system__` is the
 * audit actor. `withAuditContext` seeds the ALS frame with ipAddress
 * (sender's address — useful for forensics and rate-limiting investigations),
 * userAgent (typically "JIRA Webhooks"), and a per-request requestId. The
 * downstream `captureAuditEvent` call inside `applyInboundIssueUpdate` picks
 * these up automatically.
 */
async function handleWebhookReceive(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
): Promise<Response> {
  const receivedAt = new Date();
  const startMs = Date.now();
  const { token } = await params;

  // 0. Reject oversize bodies BEFORE any auth or buffering. Content-Length is
  //    a fast pre-check; the rawBody.byteLength check below catches missing or
  //    chunked-transfer cases.
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  // 1. Capture the raw request bytes BEFORE any other body access.
  //    Next.js 16 App Router consumes the body stream exactly once; the HMAC
  //    verifier needs the canonical bytes (not parse-and-re-stringified JSON).
  const rawBody = Buffer.from(await req.arrayBuffer());
  if (rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  // 2. Resolve the WebhookConfig by token. Public endpoint, no user session,
  //    so we use raw prisma per `feedback_default_to_enhanced_db.md` (the
  //    enhanced/policy-bound client would reject the read). The model's
  //    @@deny('create, update, delete', true) policy still gates writes.
  let webhookConfig: {
    id: string;
    projectId: number;
    adapterType: AdapterType;
    secret: string;
    isActive: boolean;
  } | null = null;
  try {
    webhookConfig = await prisma.webhookConfig.findUnique({
      where: { token },
      select: {
        id: true,
        projectId: true,
        adapterType: true,
        secret: true,
        isActive: true,
      },
    });
  } catch (err) {
    console.error(
      "[webhooks] DB lookup failed for token",
      redactToken(token),
      err
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (!webhookConfig || !webhookConfig.isActive) {
    // 404 with the same body for "unknown" and "inactive" so callers can't
    // enumerate active tokens.
    console.warn("[webhooks] no active config for token", redactToken(token));
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // 3. Decrypt the per-config HMAC secret (encrypted at rest).
  let plainSecret: string;
  try {
    plainSecret = await decrypt(webhookConfig.secret);
  } catch (err) {
    console.error(
      "[webhooks] failed to decrypt secret for token",
      redactToken(token),
      err
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // 4. Resolve the adapter via the registry. JIRA + GITHUB + AZURE_DEVOPS
  //    are all wired. SLACK + GENERIC_HMAC remain OUTBOUND-only and throw
  //    if encountered here.
  let adapter;
  try {
    adapter = getAdapter(webhookConfig.adapterType);
  } catch (err) {
    // OUTBOUND-only adapter on an INBOUND config (admin form prevents this in
    // practice) or unknown adapter type. Return 501 so the sender does NOT
    // retry — a missing adapter is a config mismatch, not a transient fault.
    console.error(
      "[webhooks] no adapter registered for token",
      redactToken(token),
      "adapterType=",
      webhookConfig.adapterType,
      err
    );
    return NextResponse.json({ ok: false }, { status: 501 });
  }

  // 5. Adapter-specific authentication: HMAC for JIRA/GITHUB, HTTP Basic Auth
  //    for AZURE_DEVOPS. Pure function, no I/O.
  const verify: VerifyResult = adapter.verify(
    rawBody,
    req.headers,
    plainSecret
  );
  if (!verify.valid) {
    console.warn(
      "[webhooks] verify rejected for token",
      redactToken(token),
      "reason=",
      verify.reason
    );
    // Map VerifyFail.reason to the right HTTP status so senders
    // (Jira / GitHub / ADO) take the right retry posture.
    //   - missing- / malformed- / signature-mismatch → 401 (genuine auth fail)
    //   - missing-auth / auth-mismatch (ADO Basic Auth) → 401
    //   - unparseable-body → 400 (client bug; do not retry)
    //   - missing-required-field → 200 (auth succeeded but the event is
    //     non-actionable, e.g., jira:issue_deleted without a status field;
    //     200 prevents retry storms but we DO NOT write a delivery row
    //     because we have no parsed payload — a follow-up could log a
    //     minimal "non-actionable" delivery row keyed by raw payloadDigest)
    let status: number;
    switch (verify.reason) {
      case "unparseable-body":
        status = 400;
        break;
      case "missing-required-field":
        status = 200;
        break;
      default:
        status = 401;
    }
    return NextResponse.json({ ok: false }, { status });
  }

  // 6. Compute payloadDigest over the EXACT raw bytes (idempotency key).
  const payloadDigest = createHash("sha256").update(rawBody).digest("hex");
  const latencyMs = Date.now() - startMs;

  // 7. Delegate to the domain service for all DB writes + audit emission.
  //    The service maps to one of the closed-set DeliveryOutcomes.
  //    Pass adapterType (sourced from the verified WebhookConfig row, NOT
  //    body-controlled) and eventType (from the parsed payload). The service
  //    itself looks up the adapter and runs the linked-ref + external-status
  //    extractors — the receiver shell stays adapter-agnostic and does NOT
  //    call extractors directly.
  const result = await applyInboundIssueUpdate({
    webhookConfigId: webhookConfig.id,
    projectId: webhookConfig.projectId,
    adapterType: webhookConfig.adapterType,
    eventType: verify.payload.eventType,
    payload: verify.payload,
    payloadDigest,
    receivedAt,
    latencyMs,
    statusCode: 200,
  });

  if (result.outcome === "error") {
    console.error(
      "[webhooks] service error for token",
      redactToken(token),
      "reason=",
      result.reason
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // 200 for updated / no-link / no_handler / duplicate / synthetic — senders
  // (Jira / GitHub / ADO) do not retry 2xx. Only outcome === "error" maps to
  // HTTP 500 (handled above); every other outcome falls through to 200.
  return NextResponse.json(
    { ok: true, outcome: result.outcome },
    { status: 200 }
  );
}

// Wrap with `withAuditContext` so the inbound webhook handler runs inside an
// AsyncLocalStorage frame seeded with ipAddress/userAgent/requestId.
// `captureAuditEvent` in the downstream sync service picks these up
// automatically — same posture as the v0.22.1 actor-context completeness
// pattern, even though the receiver has no user session.
export const POST = withAuditContext(handleWebhookReceive);
