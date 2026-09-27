import { describe, expect, it } from "vitest";
import { sortAccessRows, type AccessRow } from "./columns";

function row(name: string, overrides: Partial<AccessRow> = {}): AccessRow {
  return {
    id: name,
    userId: name,
    name,
    email: null,
    image: null,
    systemAccess: "USER",
    effectiveRole: { id: 1, name: "Tester" },
    source: "PROJECT_DEFAULT",
    ...overrides,
  };
}

describe("sortAccessRows", () => {
  const rows = [
    row("Zed", { systemAccess: "USER", source: "USER_PERMISSION" }),
    row("Amy", {
      systemAccess: "ADMIN",
      effectiveRole: null,
      source: "SYSTEM_ADMIN",
    }),
    row("Kim", {
      systemAccess: "PROJECTADMIN",
      effectiveRole: null,
      source: "SYSTEM_PROJECT_ADMIN",
    }),
    row("Bea", {
      effectiveRole: { id: 2, name: "Lead" },
      source: "GROUP_PERMISSION",
    }),
  ];

  it("sorts by name in either direction without mutating the input", () => {
    const asc = sortAccessRows(rows, "name", "asc").map((r) => r.name);
    expect(asc).toEqual(["Amy", "Bea", "Kim", "Zed"]);
    expect(sortAccessRows(rows, "name", "desc").map((r) => r.name)).toEqual([
      "Zed",
      "Kim",
      "Bea",
      "Amy",
    ]);
    expect(rows[0].name).toBe("Zed");
  });

  it("sorts by role with Admin, then Project Admin, ahead of role names", () => {
    expect(sortAccessRows(rows, "role", "asc").map((r) => r.name)).toEqual([
      "Amy",
      "Kim",
      "Bea",
      "Zed",
    ]);
  });

  it("sorts by source", () => {
    expect(sortAccessRows(rows, "source", "asc").map((r) => r.source)).toEqual([
      "GROUP_PERMISSION",
      "SYSTEM_ADMIN",
      "SYSTEM_PROJECT_ADMIN",
      "USER_PERMISSION",
    ]);
  });
});
