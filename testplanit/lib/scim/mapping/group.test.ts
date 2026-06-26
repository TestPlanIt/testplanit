import { readFileSync } from "fs";
import { join } from "path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { SCIM_SCHEMAS } from "../constants";
import {
  computeGroupUpdatesFromScim,
  deriveDisplayName,
  extractMemberIds,
  groupToScim,
  scimToGroupCreate,
  type DbGroupForScim,
  type ScimGroupBody,
  type ScimGroupMember,
} from "./group";

const FIXTURE_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "e2e",
  "fixtures",
  "scim"
);

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as Record<
    string,
    unknown
  >;
}

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

beforeAll(() => {
  process.env.NEXTAUTH_URL = "https://app.example.com";
});

afterAll(() => {
  if (originalNextAuthUrl === undefined) {
    delete process.env.NEXTAUTH_URL;
  } else {
    process.env.NEXTAUTH_URL = originalNextAuthUrl;
  }
});

const fixedUpdatedAt = new Date("2026-02-02T12:00:00.000Z");

function makeGroup(overrides: Partial<DbGroupForScim> = {}): DbGroupForScim {
  return {
    id: 7,
    name: "Engineering",
    externalId: "ext-grp-001",
    scimDisplayName: "engineering",
    scimExtensions: null,
    updatedAt: fixedUpdatedAt,
    isDeleted: false,
    assignedUsers: [],
    ...overrides,
  };
}

describe("groupToScim", () => {
  it("A1: emits Groups.name as the canonical displayName on GET (not the lowercased scimDisplayName)", () => {
    const result = groupToScim(
      makeGroup({ name: "Engineering", scimDisplayName: "engineering" })
    );
    expect(result.displayName).toBe("Engineering");
    expect(result.displayName).not.toBe("engineering");
  });

  it("A2: projects assignedUsers into members as [{value: user.id, display: user.name}]", () => {
    const result = groupToScim(
      makeGroup({
        assignedUsers: [
          { user: { id: "u_1", name: "Alice Liddell" } },
          { user: { id: "u_2", name: "Bob Builder" } },
        ],
      })
    );
    expect(result.members).toEqual([
      { value: "u_1", display: "Alice Liddell" },
      { value: "u_2", display: "Bob Builder" },
    ]);
  });

  it("A3: sets meta.resourceType + meta.location + meta.version + meta.lastModified from updatedAt", () => {
    const result = groupToScim(makeGroup({ id: 42 }));
    expect(result.meta).toEqual({
      resourceType: "Group",
      location: "https://app.example.com/api/scim/v2/Groups/42",
      version: fixedUpdatedAt.toISOString(),
      lastModified: fixedUpdatedAt.toISOString(),
    });
  });

  it("A4: falls back to a current ISO timestamp for meta.version / lastModified when updatedAt is null", () => {
    const before = Date.now();
    const result = groupToScim(makeGroup({ updatedAt: null }));
    const after = Date.now();
    const ts = Date.parse(result.meta.version);
    expect(Number.isFinite(ts)).toBe(true);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    expect(result.meta.lastModified).toBe(result.meta.version);
  });

  it("emits the core Group URN as schemas[0] and surfaces externalId when set", () => {
    const result = groupToScim(makeGroup({ externalId: "ext-grp-001" }));
    expect(result.schemas[0]).toBe(SCIM_SCHEMAS.CORE_GROUP);
    expect(result.externalId).toBe("ext-grp-001");
  });

  it("emits an empty members array (not undefined) when assignedUsers is missing or empty", () => {
    const empty = groupToScim(makeGroup({ assignedUsers: [] }));
    const undef = groupToScim(makeGroup({ assignedUsers: undefined }));
    expect(empty.members).toEqual([]);
    expect(undef.members).toEqual([]);
  });

  it("round-trips arbitrary URN buckets from scimExtensions onto the SCIM root", () => {
    const result = groupToScim(
      makeGroup({
        scimExtensions: {
          "urn:custom:dept": { code: "ENG" },
        },
      })
    );
    expect(result["urn:custom:dept"]).toEqual({ code: "ENG" });
    expect(result.schemas).toContain("urn:custom:dept");
  });
});

describe("scimToGroupCreate", () => {
  it("B1: writes Groups.name verbatim from body.displayName (mixed case preserved)", () => {
    const result = scimToGroupCreate({
      displayName: "Engineering",
    } as ScimGroupBody);
    expect(result.name).toBe("Engineering");
  });

  it("B2: writes Groups.scimDisplayName as body.displayName.toLowerCase()", () => {
    const result = scimToGroupCreate({
      displayName: "Engineering",
    } as ScimGroupBody);
    expect(result.scimDisplayName).toBe("engineering");
  });

  it("B3: sets externalId from body.externalId, null when omitted", () => {
    const withExt = scimToGroupCreate({
      displayName: "G",
      externalId: "ext-001",
    } as ScimGroupBody);
    const withoutExt = scimToGroupCreate({
      displayName: "G",
    } as ScimGroupBody);
    expect(withExt.externalId).toBe("ext-001");
    expect(withoutExt.externalId).toBeNull();
  });

  it("B4: scimExtensions partitions URN-prefixed keys at top level (NOT deep merge); strips schemas/displayName/externalId/members/id/meta", () => {
    const body = {
      schemas: [SCIM_SCHEMAS.CORE_GROUP, "urn:custom:dept"],
      id: "ignored-id",
      displayName: "G",
      externalId: "ext-001",
      members: [{ value: "u_1" }],
      meta: { resourceType: "Group" },
      "urn:custom:dept": { code: "ENG" },
    } as unknown as ScimGroupBody;
    const result = scimToGroupCreate(body);
    const ext = result.scimExtensions as Record<string, unknown>;
    expect(ext["urn:custom:dept"]).toEqual({ code: "ENG" });
    expect(Object.keys(ext)).not.toContain("schemas");
    expect(Object.keys(ext)).not.toContain("displayName");
    expect(Object.keys(ext)).not.toContain("externalId");
    expect(Object.keys(ext)).not.toContain("members");
    expect(Object.keys(ext)).not.toContain("id");
    expect(Object.keys(ext)).not.toContain("meta");
  });

  it("ignores `__proto__` and other hostile keys when partitioning URN buckets", () => {
    const body = {
      displayName: "G",
      ["__proto__" as string]: { polluted: true },
      ["constructor" as string]: { polluted: true },
      ["prototype" as string]: { polluted: true },
    } as unknown as ScimGroupBody;
    const result = scimToGroupCreate(body);
    const ext = (result.scimExtensions ?? {}) as Record<string, unknown>;
    expect(Object.keys(ext)).not.toContain("__proto__");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("computeGroupUpdatesFromScim", () => {
  it("C1: when body.displayName differs from current.scimDisplayName, sets updates.scimDisplayName (lowercased) AND updates.name (verbatim)", () => {
    const current = makeGroup({
      name: "Engineering",
      scimDisplayName: "engineering",
    });
    const { updates } = computeGroupUpdatesFromScim(current, {
      displayName: "Platform",
    });
    expect(updates.scimDisplayName).toBe("platform");
    expect(updates.name).toBe("Platform");
  });

  it("C2: when body.displayName matches current.scimDisplayName (case-insensitively), neither updates.name nor updates.scimDisplayName is set", () => {
    const current = makeGroup({
      name: "Engineering",
      scimDisplayName: "engineering",
    });
    const { updates } = computeGroupUpdatesFromScim(current, {
      displayName: "Engineering",
    });
    expect(updates.scimDisplayName).toBeUndefined();
    expect(updates.name).toBeUndefined();
  });

  it("C3: when current.name !== current.scimDisplayName (admin renamed), computed updates.name still equals body.displayName (IdP wins on sync)", () => {
    const current = makeGroup({
      name: "Eng (admin renamed)",
      scimDisplayName: "engineering",
    });
    const { updates } = computeGroupUpdatesFromScim(current, {
      displayName: "Platform",
    });
    expect(updates.name).toBe("Platform");
    expect(updates.scimDisplayName).toBe("platform");
  });

  it("re-emits externalId only when it changes", () => {
    const current = makeGroup({ externalId: "ext-001" });
    const same = computeGroupUpdatesFromScim(current, {
      displayName: current.name,
      externalId: "ext-001",
    });
    const next = computeGroupUpdatesFromScim(current, {
      displayName: current.name,
      externalId: "ext-002",
    });
    expect(same.updates.externalId).toBeUndefined();
    expect(next.updates.externalId).toBe("ext-002");
  });

  it("returns replacedUrns when a URN bucket appears in the body", () => {
    const current = makeGroup({
      scimExtensions: { "urn:custom:dept": { code: "OLD" } },
    });
    const { updates, replacedUrns } = computeGroupUpdatesFromScim(current, {
      displayName: current.name,
      "urn:custom:dept": { code: "NEW" },
    } as Partial<ScimGroupBody>);
    expect(replacedUrns).toContain("urn:custom:dept");
    const ext = updates.scimExtensions as Record<string, unknown>;
    expect(ext["urn:custom:dept"]).toEqual({ code: "NEW" });
  });

  it("preserves URNs in current.scimExtensions that the body does NOT mention (URN-partition, never deep merge)", () => {
    const current = makeGroup({
      scimExtensions: {
        "urn:custom:dept": { code: "ENG" },
        "urn:custom:cost": { center: "C123" },
      },
    });
    const { updates } = computeGroupUpdatesFromScim(current, {
      displayName: current.name,
      "urn:custom:dept": { code: "PLAT" },
    } as Partial<ScimGroupBody>);
    const ext = updates.scimExtensions as Record<string, unknown>;
    expect(ext["urn:custom:dept"]).toEqual({ code: "PLAT" });
    expect(ext["urn:custom:cost"]).toEqual({ center: "C123" });
  });
});

describe("extractMemberIds", () => {
  it("D1: returns string[] of member.value entries when all members have string-typed value", () => {
    const result = extractMemberIds([
      { value: "u_1" },
      { value: "u_2", display: "Bob" },
    ]);
    expect(result).toEqual(["u_1", "u_2"]);
  });

  it("D2: filters out entries with missing value", () => {
    const result = extractMemberIds([
      { value: "u_1" },
      { display: "no-value" } as unknown as ScimGroupMember,
    ]);
    expect(result).toEqual(["u_1"]);
  });

  it("D3: filters out entries with non-string value (number, null, undefined)", () => {
    const result = extractMemberIds([
      { value: "u_1" },
      { value: 42 } as unknown as ScimGroupMember,
      { value: null } as unknown as ScimGroupMember,
      { value: undefined } as unknown as ScimGroupMember,
      { value: "u_2" },
    ]);
    expect(result).toEqual(["u_1", "u_2"]);
  });
});

describe("round-trip via fixtures", () => {
  it("E1: okta-post-group.json → scimToGroupCreate produces canonical+lowercased displayName + empty externalId + empty member set", () => {
    const body = loadFixture("okta-post-group.json") as ScimGroupBody;
    const result = scimToGroupCreate(body);
    expect(result.name).toBe("Test SCIMv2");
    expect(result.scimDisplayName).toBe("test scimv2");
    expect(result.externalId).toBeNull();
    expect(result.members).toEqual([]);
  });

  it("E2: okta-patch-add-member.json → extractMemberIds on Operations[0].value returns the added user id", () => {
    const body = loadFixture("okta-patch-add-member.json") as Record<
      string,
      unknown
    >;
    const ops = body.Operations as Array<{ value: ScimGroupMember[] }>;
    const ids = extractMemberIds(ops[0].value);
    expect(ids).toEqual(["23a35c27-23d3-4c03-b4c5-6443c09e7173"]);
  });

  it("E3: okta-patch-remove-member.json parses as a PATCH body with a filtered remove path", () => {
    const body = loadFixture("okta-patch-remove-member.json") as Record<
      string,
      unknown
    >;
    const ops = body.Operations as Array<{ op: string; path: string }>;
    expect(ops[0].op).toBe("remove");
    expect(ops[0].path).toBe(
      'members[value eq "89bb1940-b905-4575-9e7f-6f887cfb368e"]'
    );
  });

  it("E4: okta-patch-rename.json Operations[0].value.displayName is a string consumable by computeGroupUpdatesFromScim", () => {
    const body = loadFixture("okta-patch-rename.json") as Record<
      string,
      unknown
    >;
    const ops = body.Operations as Array<{ value: { displayName: string } }>;
    const newName = ops[0].value.displayName;
    expect(typeof newName).toBe("string");
    const current = makeGroup({
      name: "Old",
      scimDisplayName: "old",
    });
    const { updates } = computeGroupUpdatesFromScim(current, {
      displayName: newName,
    });
    expect(updates.name).toBe("Test SCIMv2");
    expect(updates.scimDisplayName).toBe("test scimv2");
  });

  it("E5: okta-put-group.json → scimToGroupCreate emits Tour Guides + lowercased + two members", () => {
    const body = loadFixture("okta-put-group.json") as ScimGroupBody;
    const result = scimToGroupCreate(body);
    expect(result.name).toBe("Tour Guides");
    expect(result.scimDisplayName).toBe("tour guides");
    expect(result.members.length).toBe(2);
    expect(extractMemberIds(result.members)).toEqual([
      "some-member-1",
      "some-member-2",
    ]);
  });

  it("E6: entra-post-group.json → scimToGroupCreate carries externalId + empty members", () => {
    const body = loadFixture("entra-post-group.json") as ScimGroupBody;
    const result = scimToGroupCreate(body);
    expect(result.name).toBe("Test Group");
    expect(result.scimDisplayName).toBe("test group");
    expect(result.externalId).toBe("8aa1a0c0-c4c3-4bc0-b4a5-2ef676900159");
    expect(result.members).toEqual([]);
  });

  it("E7: entra-patch-remove-member-no-flag.json → extractMemberIds on Operations[0].value returns the targeted user id (defensive against fixture drift; rewrite happens in the patch preprocessor)", () => {
    const body = loadFixture(
      "entra-patch-remove-member-no-flag.json"
    ) as Record<string, unknown>;
    const ops = body.Operations as Array<{
      op: string;
      path: string;
      value: ScimGroupMember[];
    }>;
    expect(ops[0].op).toBe("Remove");
    expect(ops[0].path).toBe("members");
    expect(extractMemberIds(ops[0].value)).toEqual(["u1091"]);
  });

  it("E8: entra-patch-remove-member-flag.json parses as a spec-compliant filtered remove (identical to Okta spec form)", () => {
    const body = loadFixture("entra-patch-remove-member-flag.json") as Record<
      string,
      unknown
    >;
    const ops = body.Operations as Array<{ op: string; path: string }>;
    expect(ops[0].op).toBe("remove");
    expect(ops[0].path).toBe(
      'members[value eq "7f4bc1a3-285e-48ae-8202-5accb43efb0e"]'
    );
  });
});

describe("purity discipline", () => {
  it("F1: source has no DB, no logger, no console references", () => {
    const source = readFileSync(join(__dirname, "group.ts"), "utf8");
    expect(source).not.toMatch(/~\/lib\/db/);
    expect(source).not.toMatch(/~\/lib\/services\/auditLog/);
    expect(source).not.toMatch(/~\/lib\/webhooks\//);
    expect(source).not.toMatch(/\bconsole\./);
    expect(source).not.toMatch(/\blogger\b/);
  });

  it("F2: groupToScim called twice on the same input returns deep-equal results (no module-level mutable state)", () => {
    const input = makeGroup({
      assignedUsers: [{ user: { id: "u_1", name: "Alice" } }],
      scimExtensions: { "urn:custom:foo": { x: 1 } },
    });
    const a = groupToScim(input);
    const b = groupToScim(input);
    expect(a).toEqual(b);
  });

  it("F3: scimToGroupCreate does NOT mutate its input body", () => {
    const body = Object.freeze({
      displayName: "Engineering",
      externalId: "ext-001",
      members: [{ value: "u_1" }],
      "urn:custom:dept": { code: "ENG" },
    }) as unknown as ScimGroupBody;
    expect(() => scimToGroupCreate(body)).not.toThrow();
  });
});

describe("deriveDisplayName helper", () => {
  it("returns body.displayName when set", () => {
    const current = makeGroup();
    expect(deriveDisplayName(current, { displayName: "New" })).toBe("New");
  });

  it("returns undefined when body.displayName is omitted", () => {
    const current = makeGroup();
    expect(deriveDisplayName(current, {})).toBeUndefined();
  });
});
