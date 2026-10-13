"use server";

/**
 * SCIM bearer token admin server actions.
 *
 * Three admin-gated entry points that the /admin/scim UI calls:
 *
 *   - `mintScimTokenAction`  -- create a new token, surface the plaintext
 *                                bearer to the admin exactly ONCE in the
 *                                action response, audit with the new id.
 *   - `rotateScimTokenAction` -- rotate a token's secret in place with an
 *                                overlap window, surfacing the replacement
 *                                bearer once and auditing the rotation.
 *   - `revokeScimTokenAction` -- soft-revoke a token, audit the revocation.
 *   - `testScimProbeAction`   -- run the server-side Test SCIM probe and
 *                                audit the attempt (success or failure).
 *
 * Every action opens with a `getServerAuthSession()` + `access === "ADMIN"`
 * gate; non-admin and unauthenticated callers receive an `Unauthorized`
 * payload and the service layer is never invoked. Error strings stay in
 * English (server-side errors deliberately do not flow through next-intl).
 *
 * Audit invariant: each action writes exactly one `captureAuditEvent`
 * row keyed by `entityType: "ScimToken"` and stamped with
 * `metadata.scimTokenId` so per-token attribution survives even when the
 * acting principal is a human admin. The probe action additionally hand-
 * stamps `metadata.source: "scim"` so the audit-log render distinguishes
 * SCIM-domain probes from generic ScimToken updates.
 *
 * Plaintext containment: `MintScimTokenActionResult.plaintext` is the
 * ONLY surface that carries the raw bearer back to the browser. The mint
 * dialog's `useState` must hold it transiently; it must never enter any
 * React Query / ZenStack hook cache, never be persisted client-side.
 */

import { z } from "zod/v4";

import { SCIM_MAX_ROTATION_OVERLAP_MS } from "~/lib/scim/constants";
import { probeScimToken } from "~/lib/scim/probe";
import {
  mintScimToken,
  revokeScimToken,
  rotateScimToken,
} from "~/lib/scim/tokens";
import { captureAuditEvent } from "~/lib/services/auditLog";
import { isUniqueConstraintError } from "~/lib/utils/errors";
import { getServerAuthSession } from "~/server/auth";

const mintScimTokenInputSchema = z.object({
  name: z.string().min(1).max(100),
  idpName: z.enum(["OKTA", "ENTRA", "ONELOGIN", "OTHER"]),
  expiresAt: z.date().nullable(),
});

export type MintScimTokenInput = z.infer<typeof mintScimTokenInputSchema>;

export interface MintScimTokenActionResult {
  success: boolean;
  tokenId?: string;
  /**
   * Plaintext bearer surfaced ONCE to the admin. Never re-fetchable; the
   * admin must copy it before closing the mint dialog. Must not be stored
   * in any persistent client-side cache.
   */
  plaintext?: string;
  tokenPrefix?: string;
  error?: string;
}

export async function mintScimTokenAction(
  input: MintScimTokenInput
): Promise<MintScimTokenActionResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validated: MintScimTokenInput;
  try {
    validated = mintScimTokenInputSchema.parse(input);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  try {
    const { token, plaintext } = await mintScimToken({
      ...validated,
      createdById: session.user.id,
    });

    await captureAuditEvent({
      action: "API_KEY_CREATED",
      entityType: "ScimToken",
      entityId: token.id,
      entityName: token.name,
      userId: session.user.id,
      metadata: { scimTokenId: token.id, idpName: token.idpName },
    });

    return {
      success: true,
      tokenId: token.id,
      plaintext,
      tokenPrefix: token.tokenPrefix,
    };
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return {
        success: false,
        error: "A token with that name already exists",
      };
    }
    console.error("[scim/tokens] mint failed", err);
    return { success: false, error: "Failed to mint SCIM token" };
  }
}

const rotateScimTokenInputSchema = z.object({
  tokenId: z.string().min(1),
  /**
   * How long the superseded bearer keeps working. Zero cuts over
   * immediately; the cap bounds how long two live secrets can coexist.
   */
  overlapMs: z.number().int().min(0).max(SCIM_MAX_ROTATION_OVERLAP_MS),
});

export type RotateScimTokenInput = z.infer<typeof rotateScimTokenInputSchema>;

export interface RotateScimTokenActionResult {
  success: boolean;
  /**
   * The replacement bearer, surfaced ONCE. Same show-once containment rules
   * as the mint flow: transient `useState` only, never a query cache.
   */
  plaintext?: string;
  tokenPrefix?: string;
  /** When the superseded bearer stops working; null when there is no overlap. */
  previousTokenExpiresAt?: string | null;
  error?: string;
}

/**
 * Rotate a token's secret in place with an overlap window.
 *
 * Preferred over revoke + mint because the row — and therefore every
 * `scimTokenId` provenance link and the token's name and IdP — survives, so
 * the replacement credential still owns the directory its predecessor
 * provisioned.
 */
export async function rotateScimTokenAction(
  input: RotateScimTokenInput
): Promise<RotateScimTokenActionResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  let validated: RotateScimTokenInput;
  try {
    validated = rotateScimTokenInputSchema.parse(input);
  } catch {
    return { success: false, error: "Invalid input" };
  }

  try {
    const { token, plaintext } = await rotateScimToken(
      validated.tokenId,
      validated.overlapMs,
      session.user.id
    );

    await captureAuditEvent({
      action: "UPDATE",
      entityType: "ScimToken",
      entityId: token.id,
      entityName: token.name,
      userId: session.user.id,
      metadata: {
        scimTokenId: token.id,
        scimTokenRotated: true,
        overlapMs: validated.overlapMs,
        previousTokenExpiresAt:
          token.previousTokenExpiresAt?.toISOString() ?? null,
      },
    });

    return {
      success: true,
      plaintext,
      tokenPrefix: token.tokenPrefix,
      previousTokenExpiresAt:
        token.previousTokenExpiresAt?.toISOString() ?? null,
    };
  } catch (err) {
    console.error("[scim/tokens] rotate failed", err);
    return { success: false, error: "Failed to rotate SCIM token" };
  }
}

export async function revokeScimTokenAction(
  tokenId: string
): Promise<{ success: boolean; error?: string }> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { success: false, error: "Unauthorized" };
  }

  try {
    const token = await revokeScimToken(tokenId, session.user.id);
    await captureAuditEvent({
      action: "API_KEY_REVOKED",
      entityType: "ScimToken",
      entityId: token.id,
      entityName: token.name,
      userId: session.user.id,
      metadata: { scimTokenId: token.id },
    });
    return { success: true };
  } catch (err) {
    console.error("[scim/tokens] revoke failed", err);
    return { success: false, error: "Failed to revoke SCIM token" };
  }
}

export interface TestScimProbeActionResult {
  ok: boolean;
  status: number;
  reason?: string;
  error?: string;
}

export async function testScimProbeAction(
  tokenId: string
): Promise<TestScimProbeActionResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return { ok: false, status: 0, error: "Unauthorized" };
  }

  const result = await probeScimToken(tokenId);

  await captureAuditEvent({
    action: "UPDATE",
    entityType: "ScimToken",
    entityId: tokenId,
    userId: session.user.id,
    metadata: {
      scimTokenId: tokenId,
      resultStatus: result.status,
      source: "scim",
    },
  });

  return result;
}
