import { expect } from "vitest";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";

/**
 * Structural shape of an "audit row" as observed in a test — either the
 * persisted AuditLog (with ipAddress/userAgent/requestId nested in
 * metadata) OR a synthetic reconstruction that lifts those three fields
 * to the top level (the shape the Plan 05 representative-test mocks
 * build from getAuditContext()).
 *
 * Keeping this a structural interface rather than the narrow
 * `@prisma/client` AuditLog type lets a single helper cover both
 * capture modes — direct spy on `prisma.auditLog.create(data)` AND the
 * synthesized `{ ...event, ...context }` shape used by the Plan 05 mock
 * for `captureAuditEvent`. Phase 64 D-17 locked the assertion semantics
 * (six fields non-null or __system__ + systemReason); the parameter
 * shape stays permissive so every test helper call-site compiles.
 */
export interface AuditRowLike {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: unknown;
}

/**
 * Phase 64 D-17 / SC#4 enforcement helper.
 *
 * Assert that an emitted audit row carries a complete actor context.
 * Every audit-emitting test — current and future — calls this helper
 * on the row(s) it triggers.
 *
 * - Without `allowSystem`: requires a human actor (non-null userId that
 *   is NOT the system sentinel) plus all six context fields populated.
 * - With `allowSystem: true`: permits either the full human context OR
 *   `userId === SYSTEM_ACTOR_ID` with a `systemReason` in metadata.
 */
export function expectAuditRowComplete(
  row: AuditRowLike,
  opts?: { allowSystem?: boolean }
): void {
  if (opts?.allowSystem && row.userId === SYSTEM_ACTOR_ID) {
    expect(row.metadata).toMatchObject({ systemReason: expect.any(String) });
    return;
  }
  // WR-03: reject undefined as well as null. D-17 intent is "complete
  // actor context"; a missing (undefined) field is just as incomplete as
  // an explicit null. Pre-hardening, a test forgetting to populate a
  // field on the synthetic row shape would pass silently because
  // expect(undefined).not.toBeNull() is truthy.
  expect(row.userId).toBeDefined();
  expect(row.userId).not.toBeNull();
  expect(row.userId).not.toBe(SYSTEM_ACTOR_ID);
  expect(row.userEmail).toBeDefined();
  expect(row.userEmail).not.toBeNull();
  expect(row.userName).toBeDefined();
  expect(row.userName).not.toBeNull();
  expect(row.ipAddress).toBeDefined();
  expect(row.ipAddress).not.toBeNull();
  expect(row.userAgent).toBeDefined();
  expect(row.userAgent).not.toBeNull();
  expect(row.requestId).toBeDefined();
  expect(row.requestId).not.toBeNull();
}
