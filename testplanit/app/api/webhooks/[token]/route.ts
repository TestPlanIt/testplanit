import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "~/lib/prisma";
import { getAdapter } from "~/lib/webhooks/adapters";
import type { VerifyResult } from "~/lib/webhooks/adapters/types";
import { redactToken } from "~/lib/webhooks/redaction";
import { applyJiraIssueUpdate } from "~/lib/webhooks/services/applyJiraIssueUpdate";
import { decrypt } from "~/utils/encryption";

/**
 * Inbound webhook receiver — Pattern B (opaque-token routing) per D-05.
 *
 * Token = the routing/lookup key (public-but-secret string in the URL).
 * Secret = the HMAC verification key (separate field, encrypted at rest).
 *
 * Failure-mode posture (D-12 / D-13 / T-04-01):
 *   - Unknown token       → 404 { ok: false }, no DB writes, no audit
 *   - Inactive config     → 404 (same body as unknown — callers can't enumerate)
 *   - HMAC fail           → 401 { ok: false }, no DB writes, no audit
 *   - Service error       → 500 { ok: false } (server-side log only, token redacted)
 *   - All success outcomes (updated / no-link / duplicate / synthetic) → 200,
 *     since Jira does not retry 2xx responses.
 *
 * Architectural Directive 1: registry dispatch via getAdapter — the receiver
 * never branches on the adapter discriminator inline. The route file holds
 * zero Jira-specific logic.
 *
 * Logging note (WARNING #12 follow-up): the codebase has no structured logger
 * today; we use console.{warn,error} with token-redacted strings. Promotion to
 * Pino with a redaction config is a captured follow-up post-demo.
 */
/**
 * Maximum body size accepted by the receiver. Real Jira webhook payloads cap
 * around 50 KiB; 1 MiB gives a generous safety margin while preventing
 * unauthenticated callers from buffering multi-GB POSTs and OOM'ing the pod
 * before token/HMAC validation can short-circuit them. Next.js App Router has
 * no default body-size limit on raw route handlers (the `serverActions`
 * `bodySizeLimit` config does NOT apply here).
 */
const MAX_WEBHOOK_BYTES = 1_048_576;

export async function POST(
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
    adapterType: "JIRA" | "GITHUB" | "AZURE_DEVOPS";
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
    // D-13 / T-04-01: 404 with the same body for "unknown" and "inactive".
    console.warn("[webhooks] no active config for token", redactToken(token));
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // 3. Decrypt the per-config HMAC secret (D-02 — secrets encrypted at rest).
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

  // 4. Resolve the adapter via the registry — Architectural Directive 1.
  let adapter;
  try {
    adapter = getAdapter(webhookConfig.adapterType);
  } catch (err) {
    // Unknown / not-yet-implemented adapter (GITHUB, AZURE_DEVOPS — Phase 3).
    // Return 501 (ME-04) so the sender (Jira/GitHub/ADO) does NOT retry —
    // a missing adapter is a config mismatch, not a transient server fault.
    console.error(
      "[webhooks] no adapter registered for token",
      redactToken(token),
      "adapterType=",
      webhookConfig.adapterType,
      err
    );
    return NextResponse.json({ ok: false }, { status: 501 });
  }

  // 5. HMAC verification (D-12 / WBHK-02). Pure function, no I/O.
  const verify: VerifyResult = adapter.verify(
    rawBody,
    req.headers,
    plainSecret
  );
  if (!verify.valid) {
    console.warn(
      "[webhooks] HMAC verification rejected for token",
      redactToken(token),
      "reason=",
      verify.reason
    );
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // 6. Compute payloadDigest over the EXACT raw bytes (D-04 idempotency key).
  const payloadDigest = createHash("sha256").update(rawBody).digest("hex");
  const latencyMs = Date.now() - startMs;

  // 7. Delegate to the domain service for all DB writes + audit emission.
  //    The service maps to one of the closed-set DeliveryOutcomes.
  const result = await applyJiraIssueUpdate({
    webhookConfigId: webhookConfig.id,
    projectId: webhookConfig.projectId,
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

  // 200 for updated / no-link / duplicate / synthetic — Jira does not retry 2xx.
  return NextResponse.json(
    { ok: true, outcome: result.outcome },
    { status: 200 }
  );
}
