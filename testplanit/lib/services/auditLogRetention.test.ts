import { afterEach, describe, expect, it } from "vitest";

import {
  buildAuditLogArchiveKey,
  getAuditLogArchiveBucket,
  resolveAuditLogRetention,
} from "./auditLogRetention";

const env = { ...process.env };

afterEach(() => {
  process.env = { ...env };
});

describe("resolveAuditLogRetention", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["0", null],
    ["-5", null],
    ["30.5", null],
    ["abc", null],
    ["365", 365],
    [" 90 ", 90],
  ])("AUDIT_LOG_RETENTION_DAYS=%j -> %j days", (value, expected) => {
    delete process.env.AUDIT_LOG_RETENTION_MODE;
    if (value === undefined) delete process.env.AUDIT_LOG_RETENTION_DAYS;
    else process.env.AUDIT_LOG_RETENTION_DAYS = value;
    expect(resolveAuditLogRetention()?.days ?? null).toBe(expected);
  });

  it("defaults to archive mode", () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "30";
    delete process.env.AUDIT_LOG_RETENTION_MODE;
    expect(resolveAuditLogRetention()).toEqual({ days: 30, mode: "archive" });
  });

  it("reads delete mode case-insensitively", () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "30";
    process.env.AUDIT_LOG_RETENTION_MODE = " Delete ";
    expect(resolveAuditLogRetention()).toEqual({ days: 30, mode: "delete" });
  });

  it("treats an unrecognized mode as archive, never delete", () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "30";
    process.env.AUDIT_LOG_RETENTION_MODE = "purge";
    expect(resolveAuditLogRetention()?.mode).toBe("archive");
  });

  it("lets a tenant override days and mode", () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "365";
    process.env.AUDIT_LOG_RETENTION_MODE = "archive";
    expect(
      resolveAuditLogRetention({
        auditLogRetentionDays: 90,
        auditLogRetentionMode: "delete",
      })
    ).toEqual({ days: 90, mode: "delete" });
    expect(resolveAuditLogRetention({ auditLogRetentionDays: "30" })).toEqual({
      days: 30,
      mode: "archive",
    });
  });

  it("enables retention for one tenant when the global setting is off", () => {
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
    delete process.env.AUDIT_LOG_RETENTION_MODE;
    expect(resolveAuditLogRetention({})).toBeNull();
    expect(
      resolveAuditLogRetention({
        auditLogRetentionDays: 7,
        auditLogRetentionMode: "delete",
      })
    ).toEqual({ days: 7, mode: "delete" });
  });

  it("falls back to the global days when the tenant value is invalid", () => {
    process.env.AUDIT_LOG_RETENTION_DAYS = "365";
    expect(resolveAuditLogRetention({ auditLogRetentionDays: 0 })?.days).toBe(
      365
    );
  });
});

describe("getAuditLogArchiveBucket", () => {
  it("prefers the dedicated archive bucket", () => {
    process.env.AUDIT_LOG_ARCHIVE_BUCKET = "archive";
    process.env.AWS_BUCKET_NAME = "attachments";
    expect(getAuditLogArchiveBucket()).toBe("archive");
  });

  it("falls back to the attachments bucket", () => {
    delete process.env.AUDIT_LOG_ARCHIVE_BUCKET;
    process.env.AWS_BUCKET_NAME = "attachments";
    expect(getAuditLogArchiveBucket()).toBe("attachments");
  });

  it("returns null when neither is set", () => {
    delete process.env.AUDIT_LOG_ARCHIVE_BUCKET;
    delete process.env.AWS_BUCKET_NAME;
    expect(getAuditLogArchiveBucket()).toBeNull();
  });
});

describe("buildAuditLogArchiveKey", () => {
  const base = {
    periodStart: new Date("2026-01-01T00:00:00Z"),
    firstTimestamp: new Date("2026-01-05T10:11:12.345Z"),
    firstId: "clx123",
    sha256: "abcdef0123456789".repeat(4),
  };

  it("builds a month-partitioned key", () => {
    expect(buildAuditLogArchiveKey(base)).toBe(
      "audit-log-archive/2026/01/20260105T101112345Z-clx123-abcdef012345.ndjson.gz"
    );
  });

  it("adds a sanitized tenant segment", () => {
    expect(buildAuditLogArchiveKey({ ...base, tenantId: "acme/../x" })).toBe(
      "audit-log-archive/acme____x/2026/01/20260105T101112345Z-clx123-abcdef012345.ndjson.gz"
    );
  });
});
