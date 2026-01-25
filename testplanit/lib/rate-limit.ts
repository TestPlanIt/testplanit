/**
 * Simple in-memory rate limiter for password verification attempts
 * For production with multiple instances, consider using Redis-based rate limiting
 */

interface RateLimitEntry {
  attempts: number;
  resetAt: number; // timestamp
}

// Store attempts by IP address
const attemptStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attemptStore.entries()) {
    if (now > entry.resetAt) {
      attemptStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  resetAt: Date | null;
}

/**
 * Check if a password verification attempt is allowed
 * @param identifier - Unique identifier (e.g., IP address or share key)
 * @param maxAttempts - Maximum number of attempts allowed (default: 5)
 * @param windowMs - Time window in milliseconds (default: 15 minutes)
 * @returns Rate limit result with allowed status and remaining attempts
 */
export function checkPasswordAttemptLimit(
  identifier: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): RateLimitResult {
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

  // Check if limit exceeded
  if (entry.attempts >= maxAttempts) {
    return {
      allowed: false,
      remainingAttempts: 0,
      resetAt: new Date(entry.resetAt),
    };
  }

  return {
    allowed: true,
    remainingAttempts: maxAttempts - entry.attempts - 1,
    resetAt: new Date(entry.resetAt),
  };
}

/**
 * Record a failed password attempt
 * @param identifier - Unique identifier (e.g., IP address or share key)
 * @param windowMs - Time window in milliseconds (default: 15 minutes)
 */
export function recordPasswordAttempt(
  identifier: string,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): void {
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
export function clearPasswordAttempts(identifier: string): void {
  attemptStore.delete(identifier);
}

/**
 * Get current attempt count for an identifier
 * @param identifier - Unique identifier to check
 * @returns Number of attempts or 0 if none
 */
export function getAttemptCount(identifier: string): number {
  const now = Date.now();
  const entry = attemptStore.get(identifier);

  if (!entry || now > entry.resetAt) {
    return 0;
  }

  return entry.attempts;
}
