import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContext";
import { expectAuditRowComplete, type AuditRowLike } from "./auditAssertions";

/**
 * Build a plausible audit-row fixture with all actor-context fields
 * populated. Uses the structural AuditRowLike shape (ipAddress/userAgent/
 * requestId lifted to top-level) that the Plan 05 representative tests
 * synthesize from the AuditContext + event. Individual tests override
 * the fields they are exercising.
 */
function makeAuditRow(overrides: Partial<AuditRowLike> = {}): AuditRowLike {
  return {
    userId: "user-123",
    userEmail: "alice@example.com",
    userName: "Alice",
    ipAddress: "10.0.0.1",
    userAgent: "Mozilla/5.0",
    requestId: "req_test_abc",
    metadata: null,
    ...overrides,
  };
}

describe("expectAuditRowComplete", () => {
  it("passes when all 6 actor fields are populated and userId is human", () => {
    const row = makeAuditRow();
    expect(() => expectAuditRowComplete(row)).not.toThrow();
  });

  it("throws when userId is null", () => {
    const row = makeAuditRow({ userId: null });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when userEmail is null", () => {
    const row = makeAuditRow({ userEmail: null });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when userName is null", () => {
    const row = makeAuditRow({ userName: null });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when ipAddress is null", () => {
    const row = makeAuditRow({ ipAddress: null });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when userAgent is null", () => {
    const row = makeAuditRow({ userAgent: null });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when requestId is null", () => {
    const row = makeAuditRow({ requestId: null });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when userId is SYSTEM_ACTOR_ID and allowSystem is false/undefined", () => {
    const row = makeAuditRow({ userId: SYSTEM_ACTOR_ID });
    expect(() => expectAuditRowComplete(row)).toThrow();
    expect(() => expectAuditRowComplete(row, { allowSystem: false })).toThrow();
  });

  it("passes when userId is SYSTEM_ACTOR_ID and allowSystem is true and metadata.systemReason is present", () => {
    const row = makeAuditRow({
      userId: SYSTEM_ACTOR_ID,
      userEmail: null,
      userName: null,
      ipAddress: null,
      userAgent: null,
      requestId: null,
      metadata: { systemReason: "scheduled:daily-rollup" },
    });
    expect(() =>
      expectAuditRowComplete(row, { allowSystem: true })
    ).not.toThrow();
  });

  it("throws when userId is SYSTEM_ACTOR_ID and allowSystem is true but metadata lacks systemReason", () => {
    const row = makeAuditRow({
      userId: SYSTEM_ACTOR_ID,
      metadata: null,
    });
    expect(() => expectAuditRowComplete(row, { allowSystem: true })).toThrow();

    const rowWithEmptyMetadata = makeAuditRow({
      userId: SYSTEM_ACTOR_ID,
      metadata: {},
    });
    expect(() =>
      expectAuditRowComplete(rowWithEmptyMetadata, { allowSystem: true })
    ).toThrow();
  });

  it("with allowSystem:true and a human userId, still runs the full non-null check", () => {
    // A human userId with allowSystem:true should NOT take the SYSTEM
    // branch — it must still enforce the six non-null fields.
    const row = makeAuditRow({
      userId: "user-abc",
      ipAddress: null, // should cause the human-branch assertion to fail
    });
    expect(() => expectAuditRowComplete(row, { allowSystem: true })).toThrow();
  });
});

describe("expectAuditRowComplete — WR-03 undefined rejection", () => {
  it("throws when userId is undefined", () => {
    const row = makeAuditRow({ userId: undefined });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when userEmail is undefined", () => {
    const row = makeAuditRow({ userEmail: undefined });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when userName is undefined", () => {
    const row = makeAuditRow({ userName: undefined });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when ipAddress is undefined", () => {
    const row = makeAuditRow({ ipAddress: undefined });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when userAgent is undefined", () => {
    const row = makeAuditRow({ userAgent: undefined });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });

  it("throws when requestId is undefined", () => {
    const row = makeAuditRow({ requestId: undefined });
    expect(() => expectAuditRowComplete(row)).toThrow();
  });
});
