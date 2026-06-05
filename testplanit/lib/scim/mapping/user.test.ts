import { readFileSync } from "fs";
import { join } from "path";

import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { SCIM_SCHEMAS } from "../constants";
import {
  computeUserUpdatesFromScim,
  deriveDisplayName,
  extractNonWritableUrns,
  extractPrimaryEmail,
  mergeExtensions,
  scimToUserCreate,
  userToScim,
  type ScimUserBody,
  type ScimUserResource,
} from "./user";

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

const fixedCreatedAt = new Date("2026-01-01T12:00:00.000Z");
const fixedUpdatedAt = new Date("2026-02-02T12:00:00.000Z");

interface MinimalUser {
  id: string;
  email: string;
  name: string;
  scimUserName: string | null;
  scimExternalId: string | null;
  scimGivenName: string | null;
  scimFamilyName: string | null;
  scimExtensions: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date | null;
  groups?: Array<{ group: { id: number; name: string } }>;
}

function makeUser(overrides: Partial<MinimalUser> = {}): MinimalUser {
  return {
    id: "u_1",
    email: "alice@example.com",
    name: "Alice Liddell",
    scimUserName: "alice@example.com",
    scimExternalId: "ext-001",
    scimGivenName: "Alice",
    scimFamilyName: "Liddell",
    scimExtensions: null,
    isActive: true,
    createdAt: fixedCreatedAt,
    updatedAt: fixedUpdatedAt,
    ...overrides,
  };
}

describe("userToScim", () => {
  it("A1: emits a valid minimal SCIM User resource for a minimal Prisma user", () => {
    const result = userToScim(makeUser());

    expect(result.schemas).toEqual([SCIM_SCHEMAS.CORE_USER]);
    expect(result.id).toBe("u_1");
    expect(result.userName).toBe("alice@example.com");
    expect(result.externalId).toBe("ext-001");
    expect(result.name).toEqual({
      givenName: "Alice",
      familyName: "Liddell",
      formatted: "Alice Liddell",
    });
    expect(result.emails).toEqual([
      { value: "alice@example.com", primary: true },
    ]);
    expect(result.active).toBe(true);
    expect(result.meta).toEqual({
      resourceType: "User",
      location: "https://app.example.com/scim/v2/Users/u_1",
      version: fixedUpdatedAt.toISOString(),
      lastModified: fixedUpdatedAt.toISOString(),
    });
  });

  it("A2: surfaces User.name as name.formatted on the wire", () => {
    const result = userToScim(makeUser({ name: "Liddell, Alice" }));
    expect(result.name?.formatted).toBe("Liddell, Alice");
  });

  it("A3: round-trips arbitrary URNs in scimExtensions onto the SCIM root", () => {
    const result = userToScim(
      makeUser({
        scimExtensions: {
          [SCIM_SCHEMAS.ENTERPRISE_USER]: { employeeNumber: "E123" },
          "urn:custom:foo": { bar: 1 },
        },
      })
    );

    expect(result[SCIM_SCHEMAS.ENTERPRISE_USER]).toEqual({
      employeeNumber: "E123",
    });
    expect(result["urn:custom:foo"]).toEqual({ bar: 1 });
    expect(result.schemas).toContain(SCIM_SCHEMAS.CORE_USER);
    expect(result.schemas).toContain(SCIM_SCHEMAS.ENTERPRISE_USER);
    expect(result.schemas).toContain("urn:custom:foo");
  });

  it("A4: emits no extra URN keys when scimExtensions is null or empty", () => {
    const empty = userToScim(makeUser({ scimExtensions: {} }));
    const nullExt = userToScim(makeUser({ scimExtensions: null }));

    const knownKeys = new Set([
      "schemas",
      "id",
      "userName",
      "externalId",
      "name",
      "emails",
      "active",
      "meta",
    ]);
    for (const obj of [empty, nullExt]) {
      const extra = Object.keys(obj).filter((k) => !knownKeys.has(k));
      expect(extra).toEqual([]);
    }
  });

  it("A5: emits scimUserName verbatim as userName (lowercased on write, not at read)", () => {
    const result = userToScim(makeUser({ scimUserName: "alice@example.com" }));
    expect(result.userName).toBe("alice@example.com");
  });

  it("A6: emits a SCIM groups array from user.groups", () => {
    const result = userToScim(
      makeUser({
        groups: [
          { group: { id: 1, name: "Admins" } },
          { group: { id: 2, name: "Users" } },
        ],
      })
    );
    expect(result.groups).toEqual([
      { value: "1", display: "Admins" },
      { value: "2", display: "Users" },
    ]);
  });

  it("A6b: emits no groups key when user.groups is undefined or empty", () => {
    const undef = userToScim(makeUser({ groups: undefined }));
    const empty = userToScim(makeUser({ groups: [] }));
    expect(undef.groups).toBeUndefined();
    expect(empty.groups).toBeUndefined();
  });

  it("falls back to createdAt for meta version when updatedAt is null", () => {
    const result = userToScim(makeUser({ updatedAt: null }));
    expect(result.meta.version).toBe(fixedCreatedAt.toISOString());
    expect(result.meta.lastModified).toBe(fixedCreatedAt.toISOString());
  });
});

describe("scimToUserCreate", () => {
  it("B1: maps okta-post-user fixture to a Prisma create payload with parts-joined name", () => {
    const body = loadFixture("okta-post-user.json") as ScimUserBody;
    const result = scimToUserCreate(body);

    expect(result.scimUserName).toBe("test.user@okta.local");
    expect(result.scimExternalId).toBe("00ujl29u0le5T6Aj10h7");
    expect(result.scimGivenName).toBe("Test");
    expect(result.scimFamilyName).toBe("User");
    expect(result.email).toBe("test.user@okta.local");
    expect(result.name).toBe("Test User");
    expect(result.isActive).toBe(true);
  });

  it("B2: maps entra-post-user fixture and prefers name.formatted over parts", () => {
    const body = loadFixture("entra-post-user.json") as ScimUserBody;
    const result = scimToUserCreate(body);
    expect(result.name).toBe("givenName familyName");
  });

  it("B3: drops password silently from the returned create payload", () => {
    const body = loadFixture("okta-post-user.json") as ScimUserBody;
    const result = scimToUserCreate(body);
    expect(Object.keys(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("1mz050nq");
  });

  it("B4: round-trips enterprise URN (even when empty) and roles[] via scimExtensions", () => {
    const body = loadFixture("entra-post-user.json") as ScimUserBody;
    const result = scimToUserCreate(body);
    const ext = result.scimExtensions as Record<string, unknown>;
    expect(ext).toBeDefined();
    expect(ext[SCIM_SCHEMAS.ENTERPRISE_USER]).toEqual({});
    const coreBucket = ext[SCIM_SCHEMAS.CORE_USER] as Record<string, unknown>;
    expect(coreBucket?.roles).toEqual([]);
  });

  it("B5: partitions non-writable core attrs (displayName, locale, groups) under CORE_USER URN", () => {
    const body = loadFixture("okta-post-user.json") as ScimUserBody;
    const result = scimToUserCreate(body);
    const ext = result.scimExtensions as Record<string, unknown>;
    const coreBucket = ext[SCIM_SCHEMAS.CORE_USER] as Record<string, unknown>;
    expect(coreBucket.displayName).toBe("Test User");
    expect(coreBucket.locale).toBe("en-US");
    expect(coreBucket.groups).toEqual([]);
  });

  it("B6: User.name falls back to userName when neither formatted nor name parts are present", () => {
    const body = {
      schemas: [SCIM_SCHEMAS.CORE_USER],
      userName: "fallback.user@example.com",
      emails: [{ value: "fallback.user@example.com", primary: true }],
    } as unknown as ScimUserBody;
    const result = scimToUserCreate(body);
    expect(result.name).toBe("fallback.user@example.com");
  });

  it("lowercases scimUserName even when the IdP sends mixed case", () => {
    const body = loadFixture("entra-post-user.json") as ScimUserBody;
    const result = scimToUserCreate(body);
    expect(result.scimUserName).toBe((body.userName as string).toLowerCase());
  });

  it("ignores `__proto__` keys when partitioning URNs (no prototype pollution)", () => {
    const body = {
      schemas: [SCIM_SCHEMAS.CORE_USER],
      userName: "alice@example.com",
      externalId: "ext-001",
      emails: [{ value: "alice@example.com", primary: true }],
      ["__proto__" as string]: { polluted: true },
    } as unknown as ScimUserBody;
    const result = scimToUserCreate(body);
    const ext = (result.scimExtensions ?? {}) as Record<string, unknown>;
    expect(Object.keys(ext)).not.toContain("__proto__");
    // and confirm prototype not polluted
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("mergeExtensions", () => {
  it("C1: preserves URNs from current that are absent in incoming", () => {
    const result = mergeExtensions(
      { "urn:B": { y: 2 } },
      { "urn:A": { x: 1 } }
    );
    expect(result).toEqual({ "urn:B": { y: 2 }, "urn:A": { x: 1 } });
  });

  it("C2: overwrites at the URN top level, not deep-merge", () => {
    const result = mergeExtensions(
      { "urn:A": { x: 2, y: 3 } },
      { "urn:A": { x: 1 } }
    );
    expect(result).toEqual({ "urn:A": { x: 1 } });
  });

  it("C3: returns incoming verbatim when current is null/undefined", () => {
    expect(mergeExtensions(null, { "urn:A": { x: 1 } })).toEqual({
      "urn:A": { x: 1 },
    });
    expect(mergeExtensions(undefined, { "urn:A": { x: 1 } })).toEqual({
      "urn:A": { x: 1 },
    });
  });

  it("C4: returns current unchanged when incoming is empty", () => {
    expect(mergeExtensions({ "urn:A": { x: 1 } }, {})).toEqual({
      "urn:A": { x: 1 },
    });
  });
});

describe("computeUserUpdatesFromScim", () => {
  function makeScim(over: Partial<ScimUserResource> = {}): ScimUserResource {
    return {
      schemas: [SCIM_SCHEMAS.CORE_USER],
      id: "u_1",
      userName: "alice@example.com",
      externalId: "ext-001",
      name: {
        givenName: "Alice",
        familyName: "Liddell",
        formatted: "Alice Liddell",
      },
      emails: [{ value: "alice@example.com", primary: true }],
      active: true,
      meta: {
        resourceType: "User",
        location: "https://app.example.com/scim/v2/Users/u_1",
        version: fixedUpdatedAt.toISOString(),
        lastModified: fixedUpdatedAt.toISOString(),
      },
      ...over,
    };
  }

  it("D1: returns {} when current and draft are identical", () => {
    const result = computeUserUpdatesFromScim(makeScim(), makeScim());
    expect(result).toEqual({});
  });

  it("D2: returns only isActive:false when active flips true to false", () => {
    const result = computeUserUpdatesFromScim(
      makeScim({ active: true }),
      makeScim({ active: false })
    );
    expect(result).toEqual({ isActive: false });
  });

  it("D3: re-derives User.name when only givenName changes", () => {
    const draft = makeScim({
      name: { givenName: "Beth", familyName: "Liddell" },
    });
    const result = computeUserUpdatesFromScim(makeScim(), draft);
    expect(result.scimGivenName).toBe("Beth");
    expect(result.name).toBe("Beth Liddell");
    expect(result.scimFamilyName).toBeUndefined();
  });

  it("D4: re-derives User.email from primary email; falls back to emails[0]", () => {
    const draftPrimary = makeScim({
      emails: [
        { value: "old@example.com", primary: false },
        { value: "new@example.com", primary: true },
      ],
    });
    expect(computeUserUpdatesFromScim(makeScim(), draftPrimary).email).toBe(
      "new@example.com"
    );

    const draftNoPrimary = makeScim({
      emails: [{ value: "first@example.com" }, { value: "second@example.com" }],
    });
    expect(computeUserUpdatesFromScim(makeScim(), draftNoPrimary).email).toBe(
      "first@example.com"
    );
  });

  it("D5: never emits roleId, access, authMethod, or password keys", () => {
    const draft = makeScim({
      active: false,
      name: { givenName: "Beth", familyName: "Liddell" },
    });
    const result = computeUserUpdatesFromScim(makeScim(), draft);
    const keys = Object.keys(result);
    expect(keys).not.toContain("roleId");
    expect(keys).not.toContain("access");
    expect(keys).not.toContain("authMethod");
    expect(keys).not.toContain("password");
  });

  it("D6: includes scimExtensions when draft introduces a new URN bucket", () => {
    const current = makeScim();
    const draft = makeScim();
    (draft as Record<string, unknown>)[SCIM_SCHEMAS.ENTERPRISE_USER] = {
      employeeNumber: "E999",
    };
    const result = computeUserUpdatesFromScim(current, draft);
    expect(result.scimExtensions).toBeDefined();
    const ext = result.scimExtensions as Record<string, unknown>;
    expect(ext[SCIM_SCHEMAS.ENTERPRISE_USER]).toEqual({
      employeeNumber: "E999",
    });
  });
});

describe("pure helpers", () => {
  it("extractPrimaryEmail: picks primary when set, else first", () => {
    expect(
      extractPrimaryEmail([
        { value: "a@x.com" },
        { value: "b@x.com", primary: true },
      ])
    ).toBe("b@x.com");
    expect(
      extractPrimaryEmail([{ value: "first@x.com" }, { value: "second@x.com" }])
    ).toBe("first@x.com");
    expect(extractPrimaryEmail(undefined)).toBeUndefined();
    expect(extractPrimaryEmail([])).toBeUndefined();
  });

  it("deriveDisplayName: formatted > parts > userName", () => {
    expect(
      deriveDisplayName({
        userName: "u",
        name: { formatted: "F" },
      } as ScimUserBody)
    ).toBe("F");
    expect(
      deriveDisplayName({
        userName: "u",
        name: { givenName: "G", familyName: "F" },
      } as ScimUserBody)
    ).toBe("G F");
    expect(deriveDisplayName({ userName: "fallback" } as ScimUserBody)).toBe(
      "fallback"
    );
  });

  it("extractNonWritableUrns: partitions non-writable core attrs under CORE_USER", () => {
    const body = {
      schemas: [SCIM_SCHEMAS.CORE_USER],
      userName: "u",
      externalId: "e",
      emails: [{ value: "u@x.com", primary: true }],
      active: true,
      displayName: "Display Name",
      locale: "en-US",
      title: "Engineer",
      timezone: "America/New_York",
      profileUrl: "https://example.com/u",
      roles: [],
      groups: [],
      name: { givenName: "G", familyName: "F", middleName: "M" },
      password: "secret",
    } as unknown as Record<string, unknown>;
    const ext = extractNonWritableUrns(body);
    const core = ext[SCIM_SCHEMAS.CORE_USER] as Record<string, unknown>;
    expect(core.displayName).toBe("Display Name");
    expect(core.locale).toBe("en-US");
    expect(core.title).toBe("Engineer");
    expect(core.timezone).toBe("America/New_York");
    expect(core.profileUrl).toBe("https://example.com/u");
    expect(core.roles).toEqual([]);
    expect(core.groups).toEqual([]);
    expect(core["name.middleName"]).toBe("M");
    expect(JSON.stringify(ext)).not.toContain("secret");
  });

  it("extractNonWritableUrns: passes arbitrary top-level URNs through", () => {
    const body = {
      schemas: [SCIM_SCHEMAS.CORE_USER, "urn:custom:foo"],
      userName: "u",
      "urn:custom:foo": { bar: 1 },
    } as unknown as Record<string, unknown>;
    const ext = extractNonWritableUrns(body);
    expect(ext["urn:custom:foo"]).toEqual({ bar: 1 });
  });
});

describe("round-trip via fixtures", () => {
  it("F1: userToScim(scimToUserCreate(entra-post)) preserves enterprise URN", () => {
    const body = loadFixture("entra-post-user.json") as ScimUserBody;
    const created = scimToUserCreate(body);
    const user = {
      id: "u_round",
      email: created.email as string,
      name: created.name as string,
      scimUserName: created.scimUserName as string | null,
      scimExternalId: created.scimExternalId as string | null,
      scimGivenName: created.scimGivenName as string | null,
      scimFamilyName: created.scimFamilyName as string | null,
      scimExtensions: created.scimExtensions ?? null,
      isActive: (created.isActive as boolean) ?? true,
      createdAt: fixedCreatedAt,
      updatedAt: fixedUpdatedAt,
    };
    const scim = userToScim(user);
    expect(scim[SCIM_SCHEMAS.ENTERPRISE_USER]).toBeDefined();
    expect(scim.schemas).toContain(SCIM_SCHEMAS.ENTERPRISE_USER);
  });

  it("F2: okta-put fixture round-trip preserves name.middleName via scimExtensions", () => {
    const body = loadFixture("okta-put-user.json") as ScimUserBody;
    const created = scimToUserCreate(body);
    const ext = created.scimExtensions as Record<string, unknown>;
    const core = ext[SCIM_SCHEMAS.CORE_USER] as Record<string, unknown>;
    expect(core["name.middleName"]).toBe("Excited");
  });
});
