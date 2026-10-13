import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCaseDraftPayload,
  caseDraftDigest,
  caseDraftKey,
  caseDraftStorageKey,
  clearLocalCaseDraft,
  isCaseDraftPayload,
  newerCaseDraft,
  readLocalCaseDraft,
  reviveCaseDraftValues,
  writeLocalCaseDraft,
  CASE_DRAFT_PAYLOAD_VERSION,
  type CaseDraftPayload,
} from "./caseDraft";

describe("caseDraftKey", () => {
  it("distinguishes an edit from a new case in the same numbered slot", () => {
    // Both scopes carry id 7; without the prefix they would collide on the
    // (userId, draftKey) unique index and one would overwrite the other.
    expect(caseDraftKey({ kind: "case", caseId: 7 })).toBe("case:7");
    expect(caseDraftKey({ kind: "folder", folderId: 7 })).toBe("folder:7");
  });
});

describe("buildCaseDraftPayload", () => {
  it("converts Date values to ISO strings and names them", () => {
    const payload = buildCaseDraftPayload({
      name: "Login works",
      "12": new Date("2026-03-04T05:06:07.000Z"),
    });

    expect(payload.values["12"]).toBe("2026-03-04T05:06:07.000Z");
    expect(payload.dateFields).toEqual(["12"]);
  });

  it("stores an invalid Date as null and does not mark it a date field", () => {
    const payload = buildCaseDraftPayload({ "12": new Date("nonsense") });

    expect(payload.values["12"]).toBeNull();
    expect(payload.dateFields).toEqual([]);
  });

  it("drops values JSON cannot carry", () => {
    const payload = buildCaseDraftPayload({
      name: "kept",
      onChange: () => undefined,
      upload: new File(["x"], "x.txt"),
    });

    expect(payload.values).toEqual({ name: "kept" });
  });

  it("round-trips through JSON without loss", () => {
    const payload = buildCaseDraftPayload(
      {
        name: "Login works",
        steps: [{ step: { type: "doc" }, expectedResult: { type: "doc" } }],
        "12": new Date("2026-03-04T05:06:07.000Z"),
      },
      { tags: [1, 2], issues: [] }
    );

    const revived = JSON.parse(JSON.stringify(payload));
    expect(isCaseDraftPayload(revived)).toBe(true);
    expect(reviveCaseDraftValues(revived)["12"]).toEqual(
      new Date("2026-03-04T05:06:07.000Z")
    );
  });
});

describe("isCaseDraftPayload", () => {
  const valid: CaseDraftPayload = {
    version: CASE_DRAFT_PAYLOAD_VERSION,
    values: { name: "x" },
    dateFields: [],
    extras: {},
    savedAt: "2026-03-04T05:06:07.000Z",
  };

  it("accepts a well-formed payload", () => {
    expect(isCaseDraftPayload(valid)).toBe(true);
  });

  it("rejects a payload written by an older schema version", () => {
    // The form's shape can change between deploys, so an old payload is
    // discarded rather than restored into a form it no longer describes.
    expect(
      isCaseDraftPayload({ ...valid, version: CASE_DRAFT_PAYLOAD_VERSION - 1 })
    ).toBe(false);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a string", "draft"],
    ["a missing savedAt", { ...valid, savedAt: undefined }],
    ["an unparseable savedAt", { ...valid, savedAt: "whenever" }],
    ["missing dateFields", { ...valid, dateFields: undefined }],
    ["values that are not an object", { ...valid, values: [] }],
  ])("rejects %s", (_label, candidate) => {
    expect(isCaseDraftPayload(candidate)).toBe(false);
  });
});

describe("reviveCaseDraftValues", () => {
  it("leaves a date field alone when its stored value is not a string", () => {
    const revived = reviveCaseDraftValues({
      version: CASE_DRAFT_PAYLOAD_VERSION,
      values: { "12": null },
      dateFields: ["12"],
      extras: {},
      savedAt: new Date().toISOString(),
    });

    expect(revived["12"]).toBeNull();
  });

  it("turns an unparseable stored date into undefined", () => {
    const revived = reviveCaseDraftValues({
      version: CASE_DRAFT_PAYLOAD_VERSION,
      values: { "12": "not-a-date" },
      dateFields: ["12"],
      extras: {},
      savedAt: new Date().toISOString(),
    });

    expect(revived["12"]).toBeUndefined();
  });

  it("does not mutate the payload it was given", () => {
    const payload: CaseDraftPayload = {
      version: CASE_DRAFT_PAYLOAD_VERSION,
      values: { "12": "2026-03-04T05:06:07.000Z" },
      dateFields: ["12"],
      extras: {},
      savedAt: new Date().toISOString(),
    };

    reviveCaseDraftValues(payload);
    expect(payload.values["12"]).toBe("2026-03-04T05:06:07.000Z");
  });
});

describe("caseDraftDigest", () => {
  it("ignores key order", () => {
    // react-hook-form rebuilds its values object on every change and key order
    // is not stable across those rebuilds. If order counted, the editor would
    // read as dirty on every re-render and auto-save forever.
    expect(caseDraftDigest({ a: 1, b: 2 })).toBe(
      caseDraftDigest({ b: 2, a: 1 })
    );
  });

  it("ignores keys whose value is undefined", () => {
    expect(caseDraftDigest({ a: 1, b: undefined })).toBe(
      caseDraftDigest({ a: 1 })
    );
  });

  it("respects array order", () => {
    expect(caseDraftDigest({ steps: [1, 2] })).not.toBe(
      caseDraftDigest({ steps: [2, 1] })
    );
  });

  it("changes when a nested value changes", () => {
    expect(caseDraftDigest({ steps: [{ step: { text: "a" } }] })).not.toBe(
      caseDraftDigest({ steps: [{ step: { text: "b" } }] })
    );
  });

  it("distinguishes extras", () => {
    expect(caseDraftDigest({ a: 1 }, { tags: [1] })).not.toBe(
      caseDraftDigest({ a: 1 }, { tags: [2] })
    );
  });

  it("treats a Date as its instant, not its identity", () => {
    const values = { due: new Date("2026-03-04T05:06:07.000Z") };
    const same = { due: new Date("2026-03-04T05:06:07.000Z") };
    expect(caseDraftDigest(values)).toBe(caseDraftDigest(same));
  });
});

describe("newerCaseDraft", () => {
  const at = (iso: string): CaseDraftPayload => ({
    version: CASE_DRAFT_PAYLOAD_VERSION,
    values: {},
    dateFields: [],
    extras: {},
    savedAt: iso,
  });

  it("prefers the later save", () => {
    const older = at("2026-03-04T05:00:00.000Z");
    const newer = at("2026-03-04T06:00:00.000Z");
    expect(newerCaseDraft(older, newer)).toBe(newer);
    expect(newerCaseDraft(newer, older)).toBe(newer);
  });

  it("returns whichever side exists", () => {
    const only = at("2026-03-04T05:00:00.000Z");
    expect(newerCaseDraft(null, only)).toBe(only);
    expect(newerCaseDraft(only, null)).toBe(only);
    expect(newerCaseDraft(null, null)).toBeNull();
  });

  it("prefers the first argument on an exact tie", () => {
    const local = at("2026-03-04T05:00:00.000Z");
    const remote = at("2026-03-04T05:00:00.000Z");
    expect(newerCaseDraft(local, remote)).toBe(local);
  });
});

describe("local mirror", () => {
  const key = caseDraftStorageKey("user-1", "case:7");
  const payload = buildCaseDraftPayload({ name: "Login works" });

  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("scopes the key by user so two accounts on one browser stay separate", () => {
    expect(caseDraftStorageKey("user-1", "case:7")).not.toBe(
      caseDraftStorageKey("user-2", "case:7")
    );
  });

  it("round-trips a payload", () => {
    expect(writeLocalCaseDraft(key, payload)).toBe(true);
    expect(readLocalCaseDraft(key)).toEqual(payload);
  });

  it("returns null for a missing entry", () => {
    expect(readLocalCaseDraft(key)).toBeNull();
  });

  it("returns null for a corrupt entry rather than throwing", () => {
    window.localStorage.setItem(key, "{not json");
    expect(readLocalCaseDraft(key)).toBeNull();
  });

  it("returns null for a well-formed entry that is not a draft", () => {
    window.localStorage.setItem(key, JSON.stringify({ hello: "world" }));
    expect(readLocalCaseDraft(key)).toBeNull();
  });

  it("reports a failed write instead of throwing", () => {
    // Quota exhaustion and blocked site data both surface this way; the server
    // copy is the durable one, so the editor must keep going.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(writeLocalCaseDraft(key, payload)).toBe(false);
  });

  it("swallows a throwing read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readLocalCaseDraft(key)).toBeNull();
  });

  it("clears an entry, and tolerates a throwing remove", () => {
    writeLocalCaseDraft(key, payload);
    clearLocalCaseDraft(key);
    expect(readLocalCaseDraft(key)).toBeNull();

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearLocalCaseDraft(key)).not.toThrow();
  });
});
