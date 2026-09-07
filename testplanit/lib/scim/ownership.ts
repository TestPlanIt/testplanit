/**
 * Cross-IdP ownership for SCIM-provisioned rows (V2-MULTI-IDP-01).
 *
 * v1 assumed a single identity provider: nothing on a User or Groups row
 * recorded which IdP put it there, so two IdPs pointed at the same tenant
 * would silently overwrite each other's directory. This module is the whole
 * of the rule that fixes that.
 *
 * The rule:
 *
 *   - A row with `scimTokenId = NULL` is **unowned**. Every pre-provenance
 *     row starts here, as does every manually-created user and group. The
 *     first IdP to write it claims it.
 *   - A row is writable by a token whose **IdP matches the owning token's
 *     IdP** — not merely by the exact token that claimed it. Ownership keyed
 *     on token id would break the documented revoke + mint rotation pattern:
 *     the replacement token would be locked out of every row its predecessor
 *     owned. Provenance still records the exact token for the audit trail.
 *   - Anything else is a cross-IdP collision: the write is refused with a
 *     409 and surfaced in the admin conflict log, rather than letting one
 *     directory quietly clobber the other.
 *
 * `IdpName.OTHER` is a single bucket, so two distinct "Other" IdPs are
 * treated as one owner. That is the documented limit of the enum; a
 * deployment needing them isolated should give each a distinct IdP type.
 */

import { captureAuditEvent } from "~/lib/services/auditLog";
import type { TxClient } from "~/lib/zenstack";
import type { IdpName } from "~/zenstack/models";

import type { ScimAuthContext } from "./auth";

/** Resource kinds that carry SCIM provenance. */
export type ScimOwnedResource = "User" | "Group";

/**
 * Thrown when a token tries to write a row provisioned by a different IdP.
 * The route layer maps this to a 409 with `scimType: "uniqueness"`, the
 * closest RFC 7644 §3.12 error type for "this resource is already spoken
 * for".
 */
export class ScimOwnershipError extends Error {
  constructor(
    public readonly resourceType: ScimOwnedResource,
    public readonly resourceId: string,
    public readonly ownerIdpName: IdpName
  ) {
    super(
      `${resourceType} ${resourceId} is provisioned by a different identity provider (${ownerIdpName})`
    );
    this.name = "ScimOwnershipError";
  }
}

/**
 * Resolve whether `ctx` may write a row currently owned by `ownerTokenId`.
 *
 * Returns the owning IdP when the write must be refused, and `null` when it
 * may proceed (unowned row, same token, or a sibling token for the same IdP).
 */
async function findBlockingOwner(
  tx: TxClient,
  ownerTokenId: string | null,
  ctx: ScimAuthContext
): Promise<IdpName | null> {
  // Loose null check on purpose: a row read without the column selected
  // yields `undefined`, which means "no owner known" exactly as NULL does.
  if (ownerTokenId == null || ownerTokenId === ctx.tokenId) {
    return null;
  }

  const owner = await tx.scimToken.findUnique({
    where: { id: ownerTokenId },
    select: { idpName: true },
  });

  // A dangling owner id (token row hard-deleted) leaves the resource
  // effectively unowned rather than permanently unwritable.
  if (!owner) return null;

  return owner.idpName === ctx.idpName ? null : owner.idpName;
}

/**
 * Guard a SCIM write against cross-IdP collision. Throws
 * `ScimOwnershipError` when the calling token's IdP does not own the row.
 *
 * Call this before mutating an existing User or Groups row on every SCIM
 * write verb (PUT / PATCH / DELETE, and the collision branches of POST).
 */
export async function assertScimWriteOwnership(
  tx: TxClient,
  resourceType: ScimOwnedResource,
  resourceId: string,
  ownerTokenId: string | null,
  ctx: ScimAuthContext
): Promise<void> {
  const blockingOwner = await findBlockingOwner(tx, ownerTokenId, ctx);
  if (blockingOwner === null) return;

  // Recorded before the throw, and safe to do so: captureAuditEvent enqueues
  // rather than writing in-transaction, so the row survives the rollback that
  // this exception is about to trigger. `scimTokenConflict` is the
  // discriminator the /admin/scim conflict log filters on.
  await captureAuditEvent({
    action: "UPDATE",
    entityType: resourceType === "User" ? "User" : "Groups",
    entityId: resourceId,
    metadata: {
      scimTokenConflict: true,
      scimTokenId: ctx.tokenId,
      scimOwnerIdpName: blockingOwner,
      scimRequestingIdpName: ctx.idpName,
    },
  });

  throw new ScimOwnershipError(resourceType, resourceId, blockingOwner);
}

/**
 * Prisma `where` fragment restricting reads to rows this token's IdP may
 * see: unowned rows plus rows owned by any token of the same IdP.
 *
 * Applied to the GET-by-id and LIST paths so one IdP cannot enumerate
 * another's directory through the SCIM surface. In a single-IdP deployment
 * this matches every row, so behaviour is unchanged.
 */
export function scimOwnershipReadFilter(ctx: ScimAuthContext) {
  return {
    OR: [{ scimTokenId: null }, { scimToken: { idpName: ctx.idpName } }],
  };
}
