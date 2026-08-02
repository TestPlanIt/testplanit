import { createHash, timingSafeEqual } from "crypto";

/**
 * Server-only token authorizing the share-replay proxy's internal fetches to
 * report routes. The share route validates the shareKey, then re-fetches the
 * report endpoints server-to-server; those requests carry this token instead
 * of user credentials. Derived from NEXTAUTH_SECRET so every replica agrees
 * without a new env var. Never send it to a client.
 */
export function internalReportBypassToken(): string {
  return createHash("sha256")
    .update(`shared-report-bypass:${process.env.NEXTAUTH_SECRET ?? ""}`)
    .digest("hex");
}

/** Constant-time check of the x-shared-report-bypass header value. */
export function isValidReportBypass(headerValue: string | null): boolean {
  if (!headerValue) return false;
  const expected = Buffer.from(internalReportBypassToken());
  const received = Buffer.from(headerValue);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}
