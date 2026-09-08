/**
 * Password history utilities for preventing password reuse (POLICY-03).
 *
 * IMPORTANT: All operations use the direct DbClient (`db`), NOT the
 * ZenStack-enhanced client. PasswordHistory access rules block create/update/delete
 * via ZenStack REST API — system writes must go through the raw client.
 *
 * PasswordHistory.hash stores raw bcrypt output. It uses @omit (stripped from
 * REST responses) but NOT @password (which would double-hash on write).
 *
 * deleteMany is used intentionally for pruning — PasswordHistory records are
 * NOT business entities and do not follow the soft-delete convention.
 */

import { compare } from "bcrypt";
import { db } from "~/server/db";

/**
 * Check if a candidate password matches any of the user's recent password hashes.
 *
 * @param userId - The user ID to check history for
 * @param candidatePassword - The plaintext password to check (NOT a hash)
 * @param depth - Number of recent passwords to check (0 = disabled, return false)
 * @returns true if the candidate matches any recent password hash
 */
export async function isPasswordInHistory(
  userId: string,
  candidatePassword: string,
  depth: number
): Promise<boolean> {
  if (depth <= 0) return false;

  const history = await db.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: depth,
    select: { hash: true },
  });

  for (const record of history) {
    if (await compare(candidatePassword, record.hash)) {
      return true;
    }
  }
  return false;
}

/**
 * Add a password hash to the user's history and prune entries beyond the configured depth.
 *
 * @param userId - The user ID
 * @param newHash - The bcrypt hash of the new password (already hashed, NOT plaintext)
 * @param depth - Max history entries to keep (0 = disabled, no-op)
 */
export async function updatePasswordHistory(
  userId: string,
  newHash: string,
  depth: number
): Promise<void> {
  if (depth <= 0) return;

  // Insert the new hash
  await db.passwordHistory.create({
    data: { userId, hash: newHash },
  });

  // Prune entries beyond the depth limit
  // Keep the N most recent, delete the rest
  const toKeep = await db.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: depth,
    select: { id: true },
  });
  const keepIds = toKeep.map((r) => r.id);

  // Intentional hard delete — PasswordHistory records are hash storage,
  // not business entities. They do not follow the soft-delete convention.
  await db.passwordHistory.deleteMany({
    where: { userId, id: { notIn: keepIds } },
  });
}
