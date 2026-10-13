/**
 * Live-DB test helper: provision a REAL ScimToken row for integration tests.
 *
 * Before cross-IdP provenance existed, integration tests could invent a
 * `ctx.tokenId` string because nothing referenced it. `User.scimTokenId` and
 * `Groups.scimTokenId` are now foreign keys onto ScimToken, so a synthetic id
 * fails the constraint the moment a SCIM write stamps provenance — which is
 * exactly what production does on every create.
 *
 * These helpers mint a genuine token so the integration suite exercises the
 * same FK path the real bearer middleware produces, and sweep it afterwards.
 */

import { mintScimToken } from "~/lib/scim/tokens";
import { SCIM_SYSTEM_USER_ID } from "~/lib/scim/constants";

import type { ScimAuthContext } from "~/lib/scim/auth";
import type { IdpName } from "~/zenstack/models";

/** Minimal shape of the raw client these helpers need. */
interface ScimTokenSweeper {
  scimToken: {
    deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<unknown>;
  };
}

export interface IntegrationScimToken {
  ctx: ScimAuthContext;
  tokenId: string;
}

/**
 * Mint a real ScimToken and return the auth context a service call expects.
 *
 * `label` keeps concurrent suites from colliding on the token name; `idpName`
 * lets a test provision a second token for a *different* IdP to exercise the
 * cross-IdP ownership rule against real rows.
 */
export async function provisionIntegrationScimToken(
  label: string,
  idpName: IdpName = "OKTA"
): Promise<IntegrationScimToken> {
  const { token } = await mintScimToken({
    name: `scimit-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    idpName,
    expiresAt: null,
    createdById: SCIM_SYSTEM_USER_ID,
  });

  return {
    tokenId: token.id,
    ctx: {
      tokenId: token.id,
      systemUserId: SCIM_SYSTEM_USER_ID,
      idpName,
    },
  };
}

/**
 * Hard-delete the tokens a suite minted. Safe to call with ids that are
 * already gone. Provisioned rows FK onto these with ON DELETE SET NULL, so
 * any survivors are simply released back to unowned.
 */
export async function cleanupIntegrationScimTokens(
  db: ScimTokenSweeper,
  tokenIds: string[]
): Promise<void> {
  if (tokenIds.length === 0) return;
  await db.scimToken.deleteMany({ where: { id: { in: tokenIds } } });
}
