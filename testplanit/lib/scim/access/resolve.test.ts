import { describe, expect, it } from "vitest";

import type { Access } from "~/zenstack/models";

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

describe("resolveEffectiveAccess — roles hybrid (HYBRID-01)", () => {
  it("keeps the pre-hybrid two-argument behaviour when no role tiers are passed", () => {
    expect(resolveEffectiveAccess(["USER"], "ADMIN")).toBe("USER");
    expect(resolveEffectiveAccess([], "USER")).toBe("USER");
  });

  it("treats an empty role-tier array as 'no assertion' and defers to groups", () => {
    expect(resolveEffectiveAccess(["PROJECTADMIN"], "NONE", [])).toBe(
      "PROJECTADMIN"
    );
  });

  it("lets a role tier override a HIGHER group tier (precedence, not highest-wins)", () => {
    const result = resolveEffectiveAccess(["ADMIN"], "NONE", ["USER"]);
    expect(result).toBe("USER");
  });

  it("lets a role tier override a LOWER group tier", () => {
    const result = resolveEffectiveAccess(["USER"], "NONE", ["ADMIN"]);
    expect(result).toBe("ADMIN");
  });

  it("applies highest-wins WITHIN the role tiers", () => {
    const tiers: Access[] = ["USER", "ADMIN", "PROJECTADMIN"];
    expect(resolveEffectiveAccess([], "NONE", tiers)).toBe("ADMIN");
  });

  it("honours a role tier of NONE as an explicit deny over any group tier", () => {
    const result = resolveEffectiveAccess(["ADMIN"], "ADMIN", ["NONE"]);
    expect(result).toBe("NONE");
  });

  it("uses a role tier even when the user has no mapped groups at all", () => {
    const result = resolveEffectiveAccess([], "NONE", ["PROJECTADMIN"]);
    expect(result).toBe("PROJECTADMIN");
  });

  it("never falls back to the default when a role tier applies", () => {
    const result = resolveEffectiveAccess([], "ADMIN", ["USER"]);
    expect(result).toBe("USER");
  });
});
