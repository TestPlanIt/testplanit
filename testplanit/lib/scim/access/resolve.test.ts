import { describe, expect, it } from "vitest";

import type { Access } from "@prisma/client";

import { ACCESS_RANK, resolveEffectiveAccess } from "./resolve";

describe("ACCESS_RANK", () => {
  it("maps each Access tier to the correct numeric rank", () => {
    expect(ACCESS_RANK["NONE"]).toBe(0);
    expect(ACCESS_RANK["USER"]).toBe(1);
    expect(ACCESS_RANK["PROJECTADMIN"]).toBe(2);
    expect(ACCESS_RANK["ADMIN"]).toBe(3);
  });
});

describe("resolveEffectiveAccess", () => {
  it("returns the fallback when no mapped groups exist (NONE fallback)", () => {
    const result = resolveEffectiveAccess([], "NONE");
    expect(result).toBe("NONE");
  });

  it("returns the fallback when no mapped groups exist (USER fallback)", () => {
    const result = resolveEffectiveAccess([], "USER");
    expect(result).toBe("USER");
  });

  it("returns ADMIN (highest-wins) across mixed tiers", () => {
    const tiers: Access[] = ["USER", "ADMIN", "PROJECTADMIN"];
    const result = resolveEffectiveAccess(tiers, "NONE");
    expect(result).toBe("ADMIN");
  });

  it("returns the single mapped tier even when the fallback is higher", () => {
    const result = resolveEffectiveAccess(["USER"], "ADMIN");
    expect(result).toBe("USER");
  });

  it("returns NONE when user is in mapped groups that map to NONE, even though fallback is USER", () => {
    const result = resolveEffectiveAccess(["NONE", "NONE"], "USER");
    expect(result).toBe("NONE");
  });
});
