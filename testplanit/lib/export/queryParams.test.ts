import { describe, expect, it } from "vitest";
import {
  cursorWhere,
  decodeCursor,
  encodeCursor,
  parsePageSize,
  parseSince,
  buildManifest,
  buildTrailer,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./queryParams";

describe("cursor codec", () => {
  it("round-trips a timestamp-based cursor", () => {
    const c = { k: "2026-05-30T10:00:00.000Z", i: 42 };
    const round = decodeCursor(encodeCursor(c));
    expect(round).toEqual(c);
  });

  it("returns null for missing input", () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(decodeCursor("not-base64")).toBeNull();
    const wrongShape = Buffer.from(JSON.stringify({ x: 1 })).toString(
      "base64url"
    );
    expect(decodeCursor(wrongShape)).toBeNull();
  });
});

describe("parsePageSize", () => {
  it("defaults when missing or non-numeric", () => {
    expect(parsePageSize(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("0")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSize("-5")).toBe(DEFAULT_PAGE_SIZE);
  });

  it("accepts in-range values", () => {
    expect(parsePageSize("250")).toBe(250);
  });

  it("clamps above the cap", () => {
    expect(parsePageSize(String(MAX_PAGE_SIZE + 1))).toBe(MAX_PAGE_SIZE);
    expect(parsePageSize("999999")).toBe(MAX_PAGE_SIZE);
  });
});

describe("parseSince", () => {
  it("parses valid ISO-8601", () => {
    const d = parseSince("2026-05-30T10:00:00.000Z");
    expect(d?.toISOString()).toBe("2026-05-30T10:00:00.000Z");
  });

  it("returns null for missing or invalid", () => {
    expect(parseSince(null)).toBeNull();
    expect(parseSince("")).toBeNull();
    expect(parseSince("not a date")).toBeNull();
  });
});

describe("cursorWhere", () => {
  it("produces a strict-forward OR for a date sort key", () => {
    const where = cursorWhere("executedAt", {
      k: "2026-05-30T10:00:00.000Z",
      i: 7,
    });
    expect(where).toEqual({
      OR: [
        { executedAt: { gt: new Date("2026-05-30T10:00:00.000Z") } },
        {
          executedAt: new Date("2026-05-30T10:00:00.000Z"),
          id: { gt: 7 },
        },
      ],
    });
  });

  it("falls back to string compare when the key is not a parseable date", () => {
    const where = cursorWhere("name", { k: "alpha", i: 3 });
    expect(where).toEqual({
      OR: [{ name: { gt: "alpha" } }, { name: "alpha", id: { gt: 3 } }],
    });
  });
});

describe("buildManifest / buildTrailer", () => {
  it("manifest carries the resource label and page metadata", () => {
    const m = buildManifest({
      resource: "test-run-results",
      since: new Date("2026-05-01T00:00:00.000Z"),
      pageSize: 250,
      projectId: 99,
    });
    expect(m).toMatchObject({
      type: "manifest",
      schemaVersion: 1,
      resource: "test-run-results",
      since: "2026-05-01T00:00:00.000Z",
      pageSize: 250,
      projectId: 99,
    });
    expect(typeof m.exportedAt).toBe("string");
  });

  it("manifest emits null since when not provided", () => {
    expect(
      buildManifest({
        resource: "audit-log",
        since: null,
        pageSize: 1000,
        projectId: null,
      })
    ).toMatchObject({ since: null, projectId: null });
  });

  it("trailer shape includes cursor and count", () => {
    expect(buildTrailer({ count: 7, cursor: "abc" })).toEqual({
      type: "end",
      count: 7,
      cursor: "abc",
    });
    expect(buildTrailer({ count: 0, cursor: null })).toEqual({
      type: "end",
      count: 0,
      cursor: null,
    });
  });
});
