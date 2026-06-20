/**
 * Cache-aside helper for the NextAuth session callback.
 *
 * The session callback runs on every request that touches NextAuth
 * (middleware, server components, most API routes). Without caching,
 * every request triggers a DB query for user + preferences. Under
 * load this is a significant source of DB pressure.
 *
 * We cache the user record in Valkey keyed by user id. The TTL (60s)
 * is short enough that profile changes propagate quickly and long
 * enough to absorb most request bursts.
 *
 * The `lastActiveAt` update is separate and runs at most once every
 * 5 minutes per user, matching the pre-existing throttle.
 */

import type { AuthMethod, User, Access, UserPreferences } from "~/zenstack/models";
import { prisma } from "./prisma";
import valkeyConnection from "./valkey";

const SESSION_USER_CACHE_TTL_SECONDS = 60;
const SESSION_USER_CACHE_PREFIX = "user:session:";
const LAST_ACTIVE_UPDATE_THROTTLE_MS = 5 * 60 * 1000;

/**
 * The shape of data cached per user. Null-able fields are represented as `null`
 * (not `undefined`) so JSON round-tripping is lossless.
 */
export interface CachedSessionUser {
  name: string | null;
  access: Access | null;
  image: string | null;
  emailVerified: string | null; // ISO string so it survives JSON
  authMethod: AuthMethod | null;
  preferences: UserPreferences | null;
  lastActiveAt: string | null; // ISO string
}

type SelectedUser = Pick<
  User,
  "name" | "access" | "image" | "emailVerified" | "authMethod" | "lastActiveAt"
> & { userPreferences: UserPreferences | null };

/**
 * Fetch user data for the session callback, with cache-aside against Valkey.
 *
 * @returns the cached or freshly-fetched user data, or null if the user doesn't exist.
 */
export async function getCachedSessionUser(
  userId: string
): Promise<CachedSessionUser | null> {
  // 1. Check cache
  if (valkeyConnection) {
    try {
      const raw = await valkeyConnection.get(
        `${SESSION_USER_CACHE_PREFIX}${userId}`
      );
      if (raw) {
        return JSON.parse(raw) as CachedSessionUser;
      }
    } catch {
      // Cache read errors are non-fatal; fall through to DB.
    }
  }

  // 2. Fetch from DB
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      access: true,
      image: true,
      emailVerified: true,
      authMethod: true,
      lastActiveAt: true,
      userPreferences: true,
    },
  });

  if (!user) return null;

  // 3. Ensure preferences exist. Upsert (not create-after-check) because
  // NextAuth fires multiple concurrent session() calls during sign-in; the
  // check-then-create above raced and threw P2002 on the second concurrent
  // call, which NextAuth surfaced as JWT_SESSION_ERROR and aborted the
  // session.
  let preferences = (user as SelectedUser).userPreferences;
  if (!preferences) {
    preferences = await prisma.userPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  const cached: CachedSessionUser = {
    name: user.name ?? null,
    access: user.access ?? null,
    image: user.image ?? null,
    emailVerified: user.emailVerified ? user.emailVerified.toISOString() : null,
    authMethod: user.authMethod ?? null,
    preferences,
    lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
  };

  // 4. Populate cache (best-effort)
  if (valkeyConnection) {
    valkeyConnection
      .set(
        `${SESSION_USER_CACHE_PREFIX}${userId}`,
        JSON.stringify(cached),
        "EX",
        SESSION_USER_CACHE_TTL_SECONDS
      )
      .catch(() => {
        // non-fatal
      });
  }

  return cached;
}

/**
 * Throttled `lastActiveAt` update. Updates at most once every 5 minutes
 * per user to avoid write amplification under heavy traffic.
 *
 * Fires the DB update async (fire-and-forget) and refreshes the cache.
 */
export async function touchLastActive(
  userId: string,
  cached: CachedSessionUser
): Promise<void> {
  const now = new Date();
  const lastActive = cached.lastActiveAt ? new Date(cached.lastActiveAt) : null;

  if (
    !lastActive ||
    now.getTime() - lastActive.getTime() > LAST_ACTIVE_UPDATE_THROTTLE_MS
  ) {
    // Fire-and-forget DB update; do not block the session callback.
    prisma.user
      .update({
        where: { id: userId },
        data: { lastActiveAt: now },
      })
      .catch(() => {
        // non-fatal
      });

    // Refresh the cache's lastActiveAt so we don't fire another update on
    // the next request within the throttle window.
    cached.lastActiveAt = now.toISOString();
    if (valkeyConnection) {
      valkeyConnection
        .set(
          `${SESSION_USER_CACHE_PREFIX}${userId}`,
          JSON.stringify(cached),
          "EX",
          SESSION_USER_CACHE_TTL_SECONDS
        )
        .catch(() => {
          // non-fatal
        });
    }
  }
}

/**
 * Invalidate a user's cached session data. Call after updating profile,
 * permissions, access level, or preferences so subsequent requests see
 * the change immediately.
 */
export async function invalidateSessionUserCache(
  userId: string
): Promise<void> {
  if (!valkeyConnection) return;
  try {
    await valkeyConnection.del(`${SESSION_USER_CACHE_PREFIX}${userId}`);
  } catch {
    // non-fatal
  }
}
