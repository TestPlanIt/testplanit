/**
 * Rate limiter for password verification attempts (share-link passwords).
 *
 * Counts in Valkey so the limit is shared across app instances. The app runs as
 * a load-balanced PAIR (`testplanit-prod-<slot>-{a,b}`), and the per-process
 * `Map` this replaced gave each instance its own counter: attempts split between
 * them, so the effective allowance roughly doubled.
 *
 * Unlike `checkRateLimit` in ./auth-security, this surface is check-then-record:
 * only FAILED attempts count, and a success clears the counter. That rules out
 * a single atomic INCR-and-compare, so the check reads and the record writes
 * separately. The resulting race — two simultaneous attempts both passing the
 * check before either records — is pre-existing and unchanged by the Valkey
 * move; it costs at most one extra attempt per concurrent burst.
 */

import valkeyConnection from "./valkey";

interface RateLimitEntry {
  attempts: number;
  resetAt: number; // timestamp
}

// Fallback store, used ONLY when Valkey is unreachable. Per-process, so it
// under-counts across instances — the bug the Valkey path exists to close. Kept
// so a Valkey outage degrades to a loose limit rather than to no limit.
const attemptStore = new Map<string, RateLimitEntry>();

const PASSWORD_ATTEMPT_KEY_PREFIX = "rl:pwd:";

const keyFor = (identifier: string) =>
  `${PASSWORD_ATTEMPT_KEY_PREFIX}${identifier}`;

// Cleanup old FALLBACK entries every 5 minutes. Valkey keys expire themselves
// via PEXPIRE and need no sweeping.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, entry] of attemptStore.entries()) {
      if (now > entry.resetAt) {
        attemptStore.delete(key);
      }
    }
  },
  5 * 60 * 1000
);

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  resetAt: Date | null;
}

function buildResult(
  attempts: number,
  maxAttempts: number,
  resetAt: Date | null
): RateLimitResult {
  if (attempts >= maxAttempts) {
    return { allowed: false, remainingAttempts: 0, resetAt };
  }
  return {
    allowed: true,
    remainingAttempts: maxAttempts - attempts - 1,
    resetAt,
  };
}

/**
 * Check if a password verification attempt is allowed. Does NOT count the
 * attempt — call `recordPasswordAttempt` on failure.
 * @param identifier - Unique identifier (e.g., IP address or share key)
 * @param maxAttempts - Maximum number of attempts allowed (default: 5)
 * @param _windowMs - Unused: the window comes from the stored entry's TTL
 * @returns Rate limit result with allowed status and remaining attempts
 */
export async function checkPasswordAttemptLimit(
  identifier: string,
  maxAttempts: number = 5,
  _windowMs: number = 15 * 60 * 1000 // 15 minutes
): Promise<RateLimitResult> {
  if (valkeyConnection) {
    try {
      const key = keyFor(identifier);
      // PTTL alongside the count so `resetAt` reflects the real expiry rather
      // than a recomputed guess. -1 = no TTL, -2 = key missing.
      const [raw, pttl] = await Promise.all([
        valkeyConnection.get(key),
        valkeyConnection.pttl(key),
      ]);

      if (raw === null) {
        // No previous attempts (or the window already expired).
        return {
          allowed: true,
          remainingAttempts: maxAttempts - 1,
          resetAt: null,
        };
      }

      const attempts = Number(raw);
      const resetAt = pttl > 0 ? new Date(Date.now() + pttl) : null;
      return buildResult(
        Number.isFinite(attempts) ? attempts : 0,
        maxAttempts,
        resetAt
      );
    } catch (error) {
      console.error(
        "[rate-limit] Valkey read error, falling back to in-memory:",
        error
      );
    }
  }

  const now = Date.now();
  const entry = attemptStore.get(identifier);

  // No previous attempts or window expired
  if (!entry || now > entry.resetAt) {
    return {
      allowed: true,
      remainingAttempts: maxAttempts - 1,
      resetAt: null,
    };
  }

  return buildResult(entry.attempts, maxAttempts, new Date(entry.resetAt));
}

/**
 * Record a failed password attempt
 * @param identifier - Unique identifier (e.g., IP address or share key)
 * @param windowMs - Time window in milliseconds (default: 15 minutes)
 */
export async function recordPasswordAttempt(
  identifier: string,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): Promise<void> {
  if (valkeyConnection) {
    try {
      const key = keyFor(identifier);
      const count = await valkeyConnection.incr(key);
      // Only on the first failure, so the window is anchored to it and repeated
      // failures cannot keep pushing the reset out.
      if (count === 1) {
        await valkeyConnection.pexpire(key, windowMs);
      }
      return;
    } catch (error) {
      console.error(
        "[rate-limit] Valkey write error, falling back to in-memory:",
        error
      );
    }
  }

  const now = Date.now();
  const entry = attemptStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    // First attempt or window expired, create new entry
    attemptStore.set(identifier, {
      attempts: 1,
      resetAt: now + windowMs,
    });
  } else {
    // Increment existing entry
    entry.attempts++;
    attemptStore.set(identifier, entry);
  }
}

/**
 * Clear rate limit for an identifier (e.g., after successful verification)
 * @param identifier - Unique identifier to clear
 */
export async function clearPasswordAttempts(identifier: string): Promise<void> {
  // Clear the fallback entry unconditionally: an earlier Valkey outage may have
  // left a stale count there, and a successful password entry should not be
  // undone by it once Valkey returns.
  attemptStore.delete(identifier);

  if (!valkeyConnection) return;
  try {
    await valkeyConnection.del(keyFor(identifier));
  } catch (error) {
    console.error("[rate-limit] Valkey delete error:", error);
  }
}

/**
 * Get current attempt count for an identifier
 * @param identifier - Unique identifier to check
 * @returns Number of attempts or 0 if none
 */
export async function getAttemptCount(identifier: string): Promise<number> {
  if (valkeyConnection) {
    try {
      const raw = await valkeyConnection.get(keyFor(identifier));
      if (raw === null) return 0;
      const attempts = Number(raw);
      return Number.isFinite(attempts) ? attempts : 0;
    } catch (error) {
      console.error(
        "[rate-limit] Valkey read error, falling back to in-memory:",
        error
      );
    }
  }

  const now = Date.now();
  const entry = attemptStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    return 0;
  }

  return entry.attempts;
}

/**
 * Clears the in-memory fallback store. Exported for testing only.
 * @internal
 */
export function _resetForTesting(): void {
  attemptStore.clear();
}
