import { describe, it, expect } from "vitest";
import {
  toNumberValue,
  toStringValue,
  toBooleanValue,
  toDateValue,
  buildNumberIdMap,
  buildStringIdMap,
  buildTemplateFieldMaps,
  resolveUserId,
  toInputJsonValue,
} from "./helpers";

describe("toNumberValue", () => {
  describe("number inputs", () => {
    it("should return the number for valid finite numbers", () => {
      expect(toNumberValue(42)).toBe(42);
      expect(toNumberValue(0)).toBe(0);
      expect(toNumberValue(-10)).toBe(-10);
      expect(toNumberValue(3.14)).toBe(3.14);
    });

    it("should return null for Infinity", () => {
      expect(toNumberValue(Infinity)).toBeNull();
      expect(toNumberValue(-Infinity)).toBeNull();
    });

    it("should return null for NaN", () => {
      expect(toNumberValue(NaN)).toBeNull();
    });
  });

  describe("bigint inputs", () => {
    it("should convert bigint to number", () => {
      expect(toNumberValue(BigInt(42))).toBe(42);
      expect(toNumberValue(BigInt(0))).toBe(0);
    });
  });

  describe("string inputs", () => {
    it("should parse valid numeric strings", () => {
      expect(toNumberValue("42")).toBe(42);
      expect(toNumberValue("3.14")).toBe(3.14);
      expect(toNumberValue("-10")).toBe(-10);
    });

    it("should handle strings with whitespace", () => {
      expect(toNumberValue("  42  ")).toBe(42);
      expect(toNumberValue("\t10\n")).toBe(10);
    });

    it("should return null for empty strings", () => {
      expect(toNumberValue("")).toBeNull();
      expect(toNumberValue("   ")).toBeNull();
    });

    it("should return null for non-numeric strings", () => {
      expect(toNumberValue("hello")).toBeNull();
      expect(toNumberValue("42abc")).toBeNull();
    });
  });

  describe("other inputs", () => {
    it("should return null for null", () => {
      expect(toNumberValue(null)).toBeNull();
    });

    it("should return null for undefined", () => {
      expect(toNumberValue(undefined)).toBeNull();
    });

    it("should return null for objects", () => {
      expect(toNumberValue({})).toBeNull();
      expect(toNumberValue([])).toBeNull();
    });

    it("should return null for booleans", () => {
      expect(toNumberValue(true)).toBeNull();
      expect(toNumberValue(false)).toBeNull();
    });
  });
});

describe("toStringValue", () => {
  describe("string inputs", () => {
    it("should return trimmed non-empty strings", () => {
      expect(toStringValue("hello")).toBe("hello");
      expect(toStringValue("  hello  ")).toBe("hello");
    });

    it("should return null for empty strings", () => {
      expect(toStringValue("")).toBeNull();
      expect(toStringValue("   ")).toBeNull();
    });
  });

  describe("number inputs", () => {
    it("should convert numbers to strings", () => {
      expect(toStringValue(42)).toBe("42");
      expect(toStringValue(3.14)).toBe("3.14");
      expect(toStringValue(0)).toBe("0");
    });
  });

  describe("bigint inputs", () => {
    it("should convert bigints to strings", () => {
      expect(toStringValue(BigInt(42))).toBe("42");
    });
  });

  describe("other inputs", () => {
    it("should return null for null", () => {
      expect(toStringValue(null)).toBeNull();
    });

    it("should return null for undefined", () => {
      expect(toStringValue(undefined)).toBeNull();
    });

    it("should return null for objects", () => {
      expect(toStringValue({})).toBeNull();
      expect(toStringValue([])).toBeNull();
    });

    it("should return null for booleans", () => {
      expect(toStringValue(true)).toBeNull();
      expect(toStringValue(false)).toBeNull();
    });
  });
});

describe("toBooleanValue", () => {
  describe("boolean inputs", () => {
    it("should return booleans as-is", () => {
      expect(toBooleanValue(true)).toBe(true);
      expect(toBooleanValue(false)).toBe(false);
    });
  });

  describe("number inputs", () => {
    it("should return true for non-zero numbers", () => {
      expect(toBooleanValue(1)).toBe(true);
      expect(toBooleanValue(42)).toBe(true);
      expect(toBooleanValue(-1)).toBe(true);
    });

    it("should return false for zero", () => {
      expect(toBooleanValue(0)).toBe(false);
    });
  });

  describe("string inputs", () => {
    it("should return true for truthy strings", () => {
      expect(toBooleanValue("1")).toBe(true);
      expect(toBooleanValue("true")).toBe(true);
      expect(toBooleanValue("TRUE")).toBe(true);
      expect(toBooleanValue("yes")).toBe(true);
      expect(toBooleanValue("YES")).toBe(true);
      expect(toBooleanValue("  true  ")).toBe(true);
    });

    it("should return false for falsy strings", () => {
      expect(toBooleanValue("0")).toBe(false);
      expect(toBooleanValue("false")).toBe(false);
      expect(toBooleanValue("no")).toBe(false);
      expect(toBooleanValue("anything")).toBe(false);
    });

    it("should return fallback for empty strings", () => {
      expect(toBooleanValue("")).toBe(false);
      expect(toBooleanValue("", true)).toBe(true);
      expect(toBooleanValue("   ", true)).toBe(true);
    });
  });

  describe("other inputs", () => {
    it("should return fallback for null/undefined", () => {
      expect(toBooleanValue(null)).toBe(false);
      expect(toBooleanValue(undefined)).toBe(false);
      expect(toBooleanValue(null, true)).toBe(true);
    });

    it("should return fallback for objects", () => {
      expect(toBooleanValue({})).toBe(false);
      expect(toBooleanValue([], true)).toBe(true);
    });
  });
});

describe("toDateValue", () => {
  describe("Date inputs", () => {
    it("should return valid Date objects as-is", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      expect(toDateValue(date)).toEqual(date);
    });

    it("should return null for invalid Date objects", () => {
      expect(toDateValue(new Date("invalid"))).toBeNull();
    });
  });

  describe("string inputs", () => {
    it("should parse ISO date strings", () => {
      const result = toDateValue("2024-01-15T10:30:00Z");
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    });

    it("should parse date strings without timezone and add Z", () => {
      const result = toDateValue("2024-01-15T10:30:00");
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    });

    it("should parse space-separated datetime strings", () => {
      const result = toDateValue("2024-01-15 10:30:00");
      expect(result).toBeInstanceOf(Date);
      expect(result?.toISOString()).toBe("2024-01-15T10:30:00.000Z");
    });

    it("should return null for empty strings", () => {
      expect(toDateValue("")).toBeNull();
      expect(toDateValue("   ")).toBeNull();
    });

    it("should return null for invalid date strings", () => {
      expect(toDateValue("not-a-date")).toBeNull();
    });
  });

  describe("number inputs", () => {
    it("should parse timestamps", () => {
      const timestamp = 1705315800000; // 2024-01-15T10:30:00Z
      const result = toDateValue(timestamp);
      expect(result).toBeInstanceOf(Date);
      expect(result?.getTime()).toBe(timestamp);
    });

    it("should return null for invalid timestamps", () => {
      expect(toDateValue(NaN)).toBeNull();
    });
  });

  describe("other inputs", () => {
    it("should return null for null/undefined", () => {
      expect(toDateValue(null)).toBeNull();
      expect(toDateValue(undefined)).toBeNull();
    });

    it("should return null for objects", () => {
      expect(toDateValue({})).toBeNull();
    });
  });
});

describe("buildNumberIdMap", () => {
  it("should build a map from source IDs to target IDs", () => {
    const entries = {
      1: { mappedTo: 100 },
      2: { mappedTo: 200 },
      3: { mappedTo: 300 },
    };

    const map = buildNumberIdMap(entries);

    expect(map.get(1)).toBe(100);
    expect(map.get(2)).toBe(200);
    expect(map.get(3)).toBe(300);
    expect(map.size).toBe(3);
  });

  it("should skip entries with null/undefined mappedTo", () => {
    const entries = {
      1: { mappedTo: 100 },
      2: { mappedTo: null },
      3: { mappedTo: undefined },
      4: {},
    };

    const map = buildNumberIdMap(entries as any);

    expect(map.get(1)).toBe(100);
    expect(map.has(2)).toBe(false);
    expect(map.has(3)).toBe(false);
    expect(map.has(4)).toBe(false);
    expect(map.size).toBe(1);
  });

  it("should handle empty entries", () => {
    expect(buildNumberIdMap({}).size).toBe(0);
  });

  it("should handle null/undefined entries", () => {
    expect(buildNumberIdMap(null as any).size).toBe(0);
    expect(buildNumberIdMap(undefined as any).size).toBe(0);
  });

  it("should convert string keys to numbers", () => {
    const entries = {
      "1": { mappedTo: 100 },
      "2": { mappedTo: 200 },
    };

    const map = buildNumberIdMap(entries);

    expect(map.get(1)).toBe(100);
    expect(map.get(2)).toBe(200);
  });
});

describe("buildStringIdMap", () => {
  it("should build a map from source IDs to string values", () => {
    const entries = {
      1: { mappedTo: "user-abc" },
      2: { mappedTo: "user-def" },
    };

    const map = buildStringIdMap(entries);

    expect(map.get(1)).toBe("user-abc");
    expect(map.get(2)).toBe("user-def");
    expect(map.size).toBe(2);
  });

  it("should skip entries with null/undefined/empty mappedTo", () => {
    const entries = {
      1: { mappedTo: "valid" },
      2: { mappedTo: null },
      3: { mappedTo: undefined },
      4: { mappedTo: "" },
      5: {},
    };

    const map = buildStringIdMap(entries as any);

    expect(map.get(1)).toBe("valid");
    expect(map.size).toBe(1);
  });

  it("should handle empty entries", () => {
    expect(buildStringIdMap({}).size).toBe(0);
  });
});

describe("buildTemplateFieldMaps", () => {
  it("should separate case and result fields", () => {
    const templateFields = {
      field1: { systemName: "precondition", mappedTo: 1, targetType: "case" },
      field2: { systemName: "steps", mappedTo: 2, targetType: "result" },
      field3: { systemName: "expected", mappedTo: 3 }, // defaults to case
    };

    const { caseFields, resultFields } = buildTemplateFieldMaps(
      templateFields as any
    );

    expect(caseFields.get("precondition")).toBe(1);
    expect(caseFields.get("expected")).toBe(3);
    expect(resultFields.get("steps")).toBe(2);
  });

  it("should use displayName when systemName is not available", () => {
    const templateFields = {
      field1: { displayName: "My Field", mappedTo: 1 },
    };

    const { caseFields } = buildTemplateFieldMaps(templateFields as any);

    expect(caseFields.get("My Field")).toBe(1);
  });

  it("should skip entries without mappedTo", () => {
    const templateFields = {
      field1: { systemName: "valid", mappedTo: 1 },
      field2: { systemName: "invalid", mappedTo: null },
      field3: { systemName: "missing" },
    };

    const { caseFields } = buildTemplateFieldMaps(templateFields as any);

    expect(caseFields.size).toBe(1);
    expect(caseFields.has("valid")).toBe(true);
  });

  it("should skip entries without systemName or displayName", () => {
    const templateFields = {
      field1: { mappedTo: 1 }, // no name
    };

    const { caseFields, resultFields } = buildTemplateFieldMaps(
      templateFields as any
    );

    expect(caseFields.size).toBe(0);
    expect(resultFields.size).toBe(0);
  });

  it("should handle empty/null/undefined templateFields", () => {
    expect(buildTemplateFieldMaps({}).caseFields.size).toBe(0);
    expect(buildTemplateFieldMaps(null as any).caseFields.size).toBe(0);
    expect(buildTemplateFieldMaps(undefined as any).caseFields.size).toBe(0);
  });
});

describe("resolveUserId", () => {
  const userIdMap = new Map<number, string>([
    [1, "user-abc"],
    [2, "user-def"],
    [3, "user-ghi"],
  ]);
  const fallbackUserId = "fallback-user";

  it("should resolve numeric value to mapped user ID", () => {
    expect(resolveUserId(userIdMap, fallbackUserId, 1)).toBe("user-abc");
    expect(resolveUserId(userIdMap, fallbackUserId, 2)).toBe("user-def");
  });

  it("should resolve string numeric value to mapped user ID", () => {
    expect(resolveUserId(userIdMap, fallbackUserId, "1")).toBe("user-abc");
    expect(resolveUserId(userIdMap, fallbackUserId, "3")).toBe("user-ghi");
  });

  it("should return fallback for unmapped IDs", () => {
    expect(resolveUserId(userIdMap, fallbackUserId, 99)).toBe(fallbackUserId);
    expect(resolveUserId(userIdMap, fallbackUserId, "99")).toBe(fallbackUserId);
  });

  it("should return fallback for null/undefined", () => {
    expect(resolveUserId(userIdMap, fallbackUserId, null)).toBe(fallbackUserId);
    expect(resolveUserId(userIdMap, fallbackUserId, undefined)).toBe(
      fallbackUserId
    );
  });

  it("should return fallback for non-numeric values", () => {
    expect(resolveUserId(userIdMap, fallbackUserId, "not-a-number")).toBe(
      fallbackUserId
    );
    expect(resolveUserId(userIdMap, fallbackUserId, {})).toBe(fallbackUserId);
  });
});

describe("toInputJsonValue", () => {
  it("should clone simple objects", () => {
    const input = { name: "test", value: 42 };
    const result = toInputJsonValue(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input); // Should be a new object
  });

  it("should clone nested objects", () => {
    const input = {
      level1: {
        level2: {
          value: "deep",
        },
      },
    };
    const result = toInputJsonValue(input) as any;

    expect(result).toEqual(input);
    expect(result.level1).not.toBe(input.level1);
  });

  it("should clone arrays", () => {
    const input = [1, 2, { nested: true }];
    const result = toInputJsonValue(input) as any;

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result[2]).not.toBe(input[2]);
  });

  it("should handle primitive values", () => {
    expect(toInputJsonValue("string")).toBe("string");
    expect(toInputJsonValue(42)).toBe(42);
    expect(toInputJsonValue(true)).toBe(true);
    expect(toInputJsonValue(null)).toBe(null);
  });

  it("should handle Date objects", () => {
    const date = new Date("2024-01-15T10:30:00Z");
    const result = toInputJsonValue(date);

    // structuredClone preserves Date objects when available
    // The function uses structuredClone if available, otherwise JSON.parse/stringify
    if (typeof globalThis.structuredClone === "function") {
      // structuredClone preserves Date
      expect(result).toEqual(date);
    } else {
      // JSON fallback converts Date to string
      expect(result).toBe("2024-01-15T10:30:00.000Z");
    }
  });
});
