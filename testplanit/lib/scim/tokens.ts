/**
 * SCIM bearer token service layer.
 *
 * One centralized place that mints, revokes, looks up, lists, and decrypts
 * SCIM bearer tokens. Every other SCIM auth surface (bearer middleware, Test
 * SCIM probe, admin UI server actions) composes against this module so the
 * encrypt + hash + Prisma write logic lives in exactly one file.
 *
 * Two parallel projections of the same bearer secret are persisted per token:
 *
 *   - `token`  -- HMAC-SHA256 hash of the plaintext, used by the bearer
 *                 middleware for the indexed lookup on every inbound request.
 *   - `secret` -- AES-256-GCM ciphertext of the plaintext, used ONLY by the
 *                 server-side probe path to re-derive the raw bearer for a
 *                 single self-call against the SCIM discovery endpoints.
 *
 * Plaintext bearer values are returned to the caller exactly ONCE from
 * `mintScimToken` and never persisted in plaintext anywhere downstream.
 */

import crypto from "crypto";

import { hashToken } from "~/lib/api-tokens";
import { prisma } from "~/lib/prisma";
import { encrypt, decrypt } from "~/utils/encryption";
import {
  SCIM_SYSTEM_USER_ID,
  SCIM_TOKEN_PREFIX,
} from "~/lib/scim/constants";
import type { IdpName, ScimToken } from "@prisma/client";

const SCIM_TOKEN_BYTES = 32;

export interface MintScimTokenInput {
  name: string;
  idpName: IdpName;
  expiresAt: Date | null;
  createdById: string;
}

export interface MintScimTokenResult {
  token: ScimToken;
  /**
   * Plaintext token shown ONCE to the admin. Never store this anywhere
   * after the mint dialog renders it; the database column `secret` holds
   * the encrypted form, and the `token` column holds the lookup hash.
   */
  plaintext: string;
}

/**
 * Generate a new SCIM bearer token, persist its hash + encrypted secret,
 * and return the plaintext to the caller exactly ONCE.
 *
 * The caller (a server action) is responsible for handling Prisma errors --
 * uniqueness conflicts on `name` surface as P2002 and should be mapped to a
 * user-facing "name already in use" message by the server action. This
 * helper deliberately does not swallow Prisma errors.
 */
export async function mintScimToken(
  input: MintScimTokenInput
): Promise<MintScimTokenResult> {
  const randomPart = crypto
    .randomBytes(SCIM_TOKEN_BYTES)
    .toString("base64url");
  const plaintext = `${SCIM_TOKEN_PREFIX}${randomPart}`;
  const hash = hashToken(plaintext);
  const tokenPrefix = plaintext.substring(0, 12);
  const encryptedSecret = await encrypt(plaintext);

  const token = await prisma.scimToken.create({
    data: {
      name: input.name,
      idpName: input.idpName,
      token: hash,
      tokenPrefix,
      secret: encryptedSecret,
      systemUserId: SCIM_SYSTEM_USER_ID,
      createdById: input.createdById,
      expiresAt: input.expiresAt,
      isActive: true,
    },
  });

  return { token, plaintext };
}

/**
 * Soft-revoke a SCIM token. The row stays in the database forever so audit
 * rows that FK against it keep their referential integrity; the bearer
 * middleware rejects requests once `revokedAt` is set.
 */
export async function revokeScimToken(
  id: string,
  revokedById: string
): Promise<ScimToken> {
  return prisma.scimToken.update({
    where: { id },
    data: {
      isActive: false,
      revokedAt: new Date(),
      revokedById,
    },
  });
}

/**
 * Direct findUnique passthrough. Returns null when no row matches.
 */
export async function getScimTokenById(
  id: string
): Promise<ScimToken | null> {
  return prisma.scimToken.findUnique({ where: { id } });
}

/**
 * List tokens for the admin UI. By default only active (non-revoked) tokens
 * are returned; pass `showRevoked: true` to include revoked rows for the
 * collapsed "Revoked" section. `search` does a case-insensitive `contains`
 * filter on `name`.
 */
export async function listScimTokens(opts: {
  showRevoked?: boolean;
  search?: string;
}): Promise<ScimToken[]> {
  return prisma.scimToken.findMany({
    where: {
      AND: [
        opts.showRevoked ? {} : { isActive: true },
        opts.search
          ? { name: { contains: opts.search, mode: "insensitive" } }
          : {},
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Decrypt the at-rest `secret` column to recover the original plaintext
 * bearer. ONLY safe to call from server-side code (the Test SCIM probe and
 * the integration test that verifies the encryption roundtrip). The result
 * MUST NOT cross any network boundary except as the Authorization header on
 * a same-process self-call to `${NEXTAUTH_URL}/scim/v2/*`.
 */
export async function decryptScimSecret(secret: string): Promise<string> {
  return decrypt(secret);
}
