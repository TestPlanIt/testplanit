import { describe, expect, it } from "vitest";

import { applyMapping, SKIP_SENTINEL } from "./datasetMapping";

describe("applyMapping", () => {
  it("returns an empty object when the mapping is empty", () => {
    expect(applyMapping({ a: 1, b: 2 }, {})).toEqual({});
  });

  it("returns an empty object when every mapped value is the skip sentinel", () => {
    const rawRow = { user_email: "a@b.c", user_password: "secret" };
    const mapping = {
      user_email: SKIP_SENTINEL,
      user_password: SKIP_SENTINEL,
    };
    expect(applyMapping(rawRow, mapping)).toEqual({});
  });

  it("maps source columns to parameter names on the happy path", () => {
    const rawRow = { user_email: "a@b.c", user_password: "secret" };
    const mapping = { user_email: "email", user_password: "password" };
    expect(applyMapping(rawRow, mapping)).toEqual({
      email: "a@b.c",
      password: "secret",
    });
  });

  it("omits any mapped column that is missing from the raw row (no undefined in output)", () => {
    const rawRow = { user_email: "a@b.c" };
    const mapping = { user_email: "email", user_password: "password" };
    const result = applyMapping(rawRow, mapping);
    expect(result).toEqual({ email: "a@b.c" });
    expect("password" in result).toBe(false);
  });

  it("ignores prototype keys when reading from the raw row (no prototype pollution)", () => {
    const rawRow: Record<string, unknown> = { real: "value" };
    // The mapping author tries to pull __proto__ off the raw row — but
    // __proto__ is not an own property, so applyMapping must not write
    // anything for that mapping entry.
    const mapping = { __proto__: "p" };
    const result = applyMapping(rawRow, mapping);
    expect(result).toEqual({});
    // Object.prototype must still be a vanilla object (no `p` polluted in).
    expect(Object.prototype).not.toHaveProperty("p");
  });

  it("does not mutate the source raw row", () => {
    const rawRow = { user_email: "a@b.c" };
    const frozen = Object.freeze({ ...rawRow });
    const mapping = { user_email: "email" };
    const result = applyMapping(frozen, mapping);
    expect(result).toEqual({ email: "a@b.c" });
    expect(frozen).toEqual({ user_email: "a@b.c" });
  });

  it("does not mutate the mapping object", () => {
    const mapping = Object.freeze({ user_email: "email" });
    expect(() => applyMapping({ user_email: "x" }, mapping)).not.toThrow();
    expect(mapping).toEqual({ user_email: "email" });
  });

  it("handles a mix of skip sentinels and real mappings", () => {
    const rawRow = { keep_me: 1, drop_me: 2, missing: undefined };
    const mapping = {
      keep_me: "kept",
      drop_me: SKIP_SENTINEL,
      not_in_row: "phantom",
    };
    expect(applyMapping(rawRow, mapping)).toEqual({ kept: 1 });
  });

  it("preserves null and falsy column values (no truthiness filter)", () => {
    const rawRow = { a: null, b: 0, c: "", d: false };
    const mapping = { a: "pa", b: "pb", c: "pc", d: "pd" };
    expect(applyMapping(rawRow, mapping)).toEqual({
      pa: null,
      pb: 0,
      pc: "",
      pd: false,
    });
  });
});
