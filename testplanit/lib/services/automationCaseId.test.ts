import { describe, it, expect } from "vitest";

import {
  parseCaseMatcher,
  parseCaseIdFormat,
  parseCaseIdsFromName,
  parseCaseIdsFromProperty,
  resolveCaseIdRefs,
} from "./automationCaseId";

describe("parseCaseMatcher", () => {
  it("accepts known matchers", () => {
    expect(parseCaseMatcher("name")).toBe("name");
    expect(parseCaseMatcher("property")).toBe("property");
    expect(parseCaseMatcher("auto")).toBe("auto");
    expect(parseCaseMatcher("off")).toBe("off");
  });

  it("defaults unknown/empty values to off", () => {
    expect(parseCaseMatcher(undefined)).toBe("off");
    expect(parseCaseMatcher(null)).toBe("off");
    expect(parseCaseMatcher("")).toBe("off");
    expect(parseCaseMatcher("bogus")).toBe("off");
  });
});

describe("parseCaseIdFormat", () => {
  it("accepts known formats", () => {
    expect(parseCaseIdFormat("brackets")).toBe("brackets");
    expect(parseCaseIdFormat("c")).toBe("c");
    expect(parseCaseIdFormat("tc")).toBe("tc");
  });

  it("defaults unknown/empty values to brackets", () => {
    expect(parseCaseIdFormat(undefined)).toBe("brackets");
    expect(parseCaseIdFormat("nope")).toBe("brackets");
  });
});

describe("parseCaseIdsFromName - brackets", () => {
  it("extracts a single id", () => {
    expect(parseCaseIdsFromName("[123] user can log in", "brackets")).toEqual([
      123,
    ]);
  });

  it("tolerates a leading C (TestRail style)", () => {
    expect(parseCaseIdsFromName("[C123] login", "brackets")).toEqual([123]);
  });

  it("extracts multiple ids inside one bracket", () => {
    expect(parseCaseIdsFromName("[123, 456] login", "brackets")).toEqual([
      123, 456,
    ]);
  });

  it("extracts ids from multiple brackets", () => {
    expect(parseCaseIdsFromName("[12][34] login", "brackets")).toEqual([
      12, 34,
    ]);
  });

  it("de-duplicates repeated ids", () => {
    expect(parseCaseIdsFromName("[12, 12] login", "brackets")).toEqual([12]);
  });

  it("ignores brackets that are not pure id tokens", () => {
    expect(parseCaseIdsFromName("[2024-01-01] nightly", "brackets")).toEqual(
      []
    );
  });

  it("returns empty when there is no bracket", () => {
    expect(parseCaseIdsFromName("plain test name", "brackets")).toEqual([]);
  });
});

describe("parseCaseIdsFromName - c", () => {
  it("extracts a C-prefixed id", () => {
    expect(parseCaseIdsFromName("C123 login", "c")).toEqual([123]);
  });

  it("is case-insensitive on the prefix", () => {
    expect(parseCaseIdsFromName("c7 login", "c")).toEqual([7]);
  });

  it("ignores a C preceded by a letter (ABC123)", () => {
    expect(parseCaseIdsFromName("ABC123 login", "c")).toEqual([]);
  });

  it("extracts underscore-separated ids (TestRail style)", () => {
    expect(parseCaseIdsFromName("C200_C201_C202_endpoints", "c")).toEqual([
      200, 201, 202,
    ]);
  });
});

describe("parseCaseIdsFromName - tc", () => {
  it("extracts TC-123 and TC123", () => {
    expect(parseCaseIdsFromName("TC-123 login", "tc")).toEqual([123]);
    expect(parseCaseIdsFromName("TC456 login", "tc")).toEqual([456]);
  });

  it("is case-insensitive", () => {
    expect(parseCaseIdsFromName("tc-9 login", "tc")).toEqual([9]);
  });

  it("ignores a TC preceded by a letter", () => {
    expect(parseCaseIdsFromName("XTC-9 login", "tc")).toEqual([]);
  });
});

describe("parseCaseIdsFromProperty", () => {
  it("reads the test_id property", () => {
    expect(parseCaseIdsFromProperty({ test_id: "123" })).toEqual([123]);
  });

  it("reads the testplanit_case_id alias", () => {
    expect(parseCaseIdsFromProperty({ testplanit_case_id: "55" })).toEqual([
      55,
    ]);
  });

  it("is case-insensitive on the property key", () => {
    expect(parseCaseIdsFromProperty({ Test_ID: "8" })).toEqual([8]);
  });

  it("parses a comma-separated list with C prefixes", () => {
    expect(parseCaseIdsFromProperty({ test_id: "C123, C456" })).toEqual([
      123, 456,
    ]);
  });

  it("returns empty for absent metadata or unknown keys", () => {
    expect(parseCaseIdsFromProperty(undefined)).toEqual([]);
    expect(parseCaseIdsFromProperty({ iteration: "3" })).toEqual([]);
  });

  it("ignores non-numeric values", () => {
    expect(parseCaseIdsFromProperty({ test_id: "abc" })).toEqual([]);
    expect(parseCaseIdsFromProperty({ test_id: "0" })).toEqual([]);
  });

  it("does not read inherited object properties", () => {
    expect(parseCaseIdsFromProperty({})).toEqual([]);
  });
});

describe("resolveCaseIdRefs", () => {
  it("returns nothing when matcher is off", () => {
    expect(
      resolveCaseIdRefs(
        { name: "[123] login", metadata: { test_id: "456" } },
        { matcher: "off", format: "brackets" }
      )
    ).toEqual({ ids: [], source: null });
  });

  it("prefers the property over the name in auto mode", () => {
    expect(
      resolveCaseIdRefs(
        { name: "[123] login", metadata: { test_id: "456" } },
        { matcher: "auto", format: "brackets" }
      )
    ).toEqual({ ids: [456], source: "property" });
  });

  it("falls back to the name in auto mode when no property is present", () => {
    expect(
      resolveCaseIdRefs(
        { name: "[123] login" },
        { matcher: "auto", format: "brackets" }
      )
    ).toEqual({ ids: [123], source: "name" });
  });

  it("name mode ignores the property", () => {
    expect(
      resolveCaseIdRefs(
        { name: "plain", metadata: { test_id: "456" } },
        { matcher: "name", format: "brackets" }
      )
    ).toEqual({ ids: [], source: null });
  });

  it("property mode ignores the name", () => {
    expect(
      resolveCaseIdRefs(
        { name: "[123] login" },
        { matcher: "property", format: "brackets" }
      )
    ).toEqual({ ids: [], source: null });
  });
});
