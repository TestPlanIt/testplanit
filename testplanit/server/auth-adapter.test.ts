/**
 * Unit tests for createCustomDbAdapter.createUser.
 *
 * Coverage surface (NextAuth SSO/OAuth sign-in flow):
 *
 *   A. No existing row by email -> behaves as a fresh create
 *   B. Existing row with externalId=null, authMethod=null/SCIM -> JIT-link branch
 *   C. Existing row with INTERNAL/BOTH authMethod -> conservative link (do not overwrite authMethod)
 *   D. Existing row with conflicting externalId -> throws English error
 *   E. Source-shape grep sanity (one create / one update / no scim* column writes)
 *
 * Mock strategy: the adapter takes a DbClient as a parameter, so we pass a
 * plain object literal whose user/registrationSettings/roles members are vi.fn()
 * mocks. No vi.mock() is needed for the db module; this matches the adapter
 * factory's actual call site (auth.ts: createCustomDbAdapter(db)).
 *
 * NotificationService is module-mocked because the adapter imports it directly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createUserRegistrationNotification: vi.fn(),
  },
}));

vi.mock("bcrypt", () => ({
  hash: vi.fn(async () => "hashed-random-password"),
}));

import { NotificationService } from "~/lib/services/notificationService";
import { createCustomDbAdapter } from "./auth-adapter";

type Mocks = {
  user: {
    findFirst: Mock;
    findUnique: Mock;
    create: Mock;
    update: Mock;
  };
  registrationSettings: { findFirst: Mock };
  roles: { findFirst: Mock };
  account: { create: Mock };
};

function makeDbMocks(): Mocks {
  return {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    registrationSettings: { findFirst: vi.fn() },
    roles: { findFirst: vi.fn() },
    account: { create: vi.fn() },
  };
}

function makeAdapter(mocks: Mocks) {
  // Cast through unknown because the adapter typing expects a full DbClient
  // surface; tests only stub the members the createUser path touches.
  return createCustomDbAdapter(mocks as unknown as never);
}

const notify =
  NotificationService.createUserRegistrationNotification as unknown as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createUser - no existing row (fresh create path)", () => {
  it("A1: inserts a new user with SSO authMethod, default access, random password, userPreferences", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue(null);
    mocks.registrationSettings.findFirst.mockResolvedValue({
      defaultAccess: "USER",
    });
    mocks.roles.findFirst.mockResolvedValueOnce({ id: "role-default" });
    mocks.user.create.mockResolvedValue({
      id: "new-id",
      email: "new@example.com",
      name: "New User",
      image: null,
      emailVerified: new Date("2026-01-01"),
    });

    const adapter = makeAdapter(mocks);

    const result = await adapter.createUser!({
      email: "new@example.com",
      name: "New User",
      image: null,
      emailVerified: null,
    } as never);

    expect(mocks.user.create).toHaveBeenCalledTimes(1);
    const createArgs = mocks.user.create.mock.calls[0][0];
    expect(createArgs.data.email).toBe("new@example.com");
    expect(createArgs.data.authMethod).toBe("SSO");
    expect(createArgs.data.access).toBe("USER");
    expect(createArgs.data.roleId).toBe("role-default");
    expect(createArgs.data.password).toBe("hashed-random-password");
    expect(createArgs.data.userPreferences).toEqual(
      expect.objectContaining({ create: expect.any(Object) })
    );

    expect(result).toEqual({
      id: "new-id",
      email: "new@example.com",
      name: "New User",
      image: null,
      emailVerified: expect.any(Date),
    });
  });

  it("A2: fires NotificationService.createUserRegistrationNotification with 'sso'", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue(null);
    mocks.registrationSettings.findFirst.mockResolvedValue({
      defaultAccess: "USER",
    });
    mocks.roles.findFirst.mockResolvedValue({ id: "role-default" });
    mocks.user.create.mockResolvedValue({
      id: "new-id",
      email: "new@example.com",
      name: "New User",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "new@example.com",
      name: "New User",
      image: null,
      emailVerified: null,
    } as never);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "New User",
      "new@example.com",
      "new-id",
      "sso"
    );
  });
});

describe("createUser - JIT-link branch (existing row, linkable)", () => {
  it("B1: links existing row when externalId is null and authMethod is null (admin-imported / pre-SCIM row)", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "Old Name",
      image: null,
      emailVerified: new Date("2026-01-01"),
      externalId: null,
      authMethod: null,
    });
    mocks.user.update.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date("2026-01-01"),
    });

    const adapter = makeAdapter(mocks);

    const result = await adapter.createUser!({
      email: "existing@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    expect(mocks.user.create).not.toHaveBeenCalled();
    expect(mocks.user.update).toHaveBeenCalledTimes(1);

    const updateArgs = mocks.user.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "existing-id" });
    expect(updateArgs.data.externalId).toBe("saml_nameid_abc");
    expect(updateArgs.data.authMethod).toBe("SSO");
    expect(updateArgs.data.name).toBe("SAML Name");

    expect(result.id).toBe("existing-id");
    expect(result.name).toBe("SAML Name");
  });

  it("B2: does NOT call NotificationService on the bind path", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "Old Name",
      image: null,
      emailVerified: new Date(),
      externalId: null,
      authMethod: null,
    });
    mocks.user.update.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "existing@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    expect(notify).not.toHaveBeenCalled();
  });

  it("B3: link payload does NOT include scim* / access / roleId / isActive", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "Old Name",
      image: null,
      emailVerified: new Date(),
      externalId: null,
      authMethod: "SCIM",
    });
    mocks.user.update.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "existing@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    const updateArgs = mocks.user.update.mock.calls[0][0];
    const data = updateArgs.data;
    expect(data).not.toHaveProperty("scimGivenName");
    expect(data).not.toHaveProperty("scimFamilyName");
    expect(data).not.toHaveProperty("scimExternalId");
    expect(data).not.toHaveProperty("scimUserName");
    expect(data).not.toHaveProperty("scimExtensions");
    expect(data).not.toHaveProperty("access");
    expect(data).not.toHaveProperty("roleId");
    expect(data).not.toHaveProperty("isActive");
  });

  it("B4: case-insensitive email match — user.email='Existing@Example.com' matches existing row", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "Old Name",
      image: null,
      emailVerified: new Date(),
      externalId: null,
      authMethod: null,
    });
    mocks.user.update.mockResolvedValue({
      id: "existing-id",
      email: "existing@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "Existing@Example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    const findFirstArgs = mocks.user.findFirst.mock.calls[0][0];
    // The where filter uses case-insensitive email lookup.
    expect(findFirstArgs.where.email).toEqual({
      equals: "Existing@Example.com",
      mode: "insensitive",
    });
  });
});

describe("createUser - conservative authMethod (defense for credential rows)", () => {
  it("C1: existing row with authMethod=INTERNAL keeps authMethod (sets externalId + name only)", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "internal-id",
      email: "internal@example.com",
      name: "Internal User",
      image: null,
      emailVerified: new Date(),
      externalId: null,
      authMethod: "INTERNAL",
    });
    mocks.user.update.mockResolvedValue({
      id: "internal-id",
      email: "internal@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "internal@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    const updateArgs = mocks.user.update.mock.calls[0][0];
    // authMethod is omitted (undefined) when the existing value is INTERNAL —
    // Prisma will not include it in the SQL UPDATE.
    expect(updateArgs.data.authMethod).toBeUndefined();
    expect(updateArgs.data.externalId).toBe("saml_nameid_abc");
    expect(updateArgs.data.name).toBe("SAML Name");
  });

  it("C2: existing row with authMethod=BOTH keeps authMethod", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "both-id",
      email: "both@example.com",
      name: "Both User",
      image: null,
      emailVerified: new Date(),
      externalId: null,
      authMethod: "BOTH",
    });
    mocks.user.update.mockResolvedValue({
      id: "both-id",
      email: "both@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "both@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    const updateArgs = mocks.user.update.mock.calls[0][0];
    expect(updateArgs.data.authMethod).toBeUndefined();
  });

  it("C3: existing row with authMethod=SCIM gets authMethod=SSO (SCIM -> SSO transition)", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "scim-id",
      email: "scim@example.com",
      name: "Scim User",
      image: null,
      emailVerified: new Date(),
      externalId: null,
      authMethod: "SCIM",
    });
    mocks.user.update.mockResolvedValue({
      id: "scim-id",
      email: "scim@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "scim@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    const updateArgs = mocks.user.update.mock.calls[0][0];
    expect(updateArgs.data.authMethod).toBe("SSO");
  });

  it("C4: existing row with authMethod=null gets authMethod=SSO", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "null-id",
      email: "null@example.com",
      name: "Null User",
      image: null,
      emailVerified: new Date(),
      externalId: null,
      authMethod: null,
    });
    mocks.user.update.mockResolvedValue({
      id: "null-id",
      email: "null@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: new Date(),
    });

    const adapter = makeAdapter(mocks);

    await adapter.createUser!({
      email: "null@example.com",
      name: "SAML Name",
      image: null,
      emailVerified: null,
      externalId: "saml_nameid_abc",
    } as never);

    const updateArgs = mocks.user.update.mock.calls[0][0];
    expect(updateArgs.data.authMethod).toBe("SSO");
  });
});

describe("createUser - conflicting externalId", () => {
  it("D1: existing row with different externalId throws English error mentioning 'external identity conflict'", async () => {
    const mocks = makeDbMocks();
    mocks.user.findFirst.mockResolvedValue({
      id: "conflict-id",
      email: "conflict@example.com",
      name: "Conflict User",
      image: null,
      emailVerified: new Date(),
      externalId: "saml_old_nameid",
      authMethod: "SSO",
    });

    const adapter = makeAdapter(mocks);

    await expect(
      adapter.createUser!({
        email: "conflict@example.com",
        name: "Conflict User",
        image: null,
        emailVerified: null,
        externalId: "saml_new_nameid",
      } as never)
    ).rejects.toThrow(/external identity conflict/i);

    expect(mocks.user.create).not.toHaveBeenCalled();
    expect(mocks.user.update).not.toHaveBeenCalled();
  });
});

describe("createUser - source-shape sanity", () => {
  const adapterSource = readFileSync(
    join(__dirname, "auth-adapter.ts"),
    "utf-8"
  );

  it("E1: exactly one db.user.create call in the file", () => {
    const matches = adapterSource.match(/\.user\.create\(/g) || [];
    expect(matches).toHaveLength(1);
  });

  it("E2: exactly two db.user.update calls in the file", () => {
    // One in the base adapter's generic updateUser, and one in the createUser
    // override's existing-user link branch. Anything beyond these two would
    // signal an accidental extra user mutation in the sign-in path.
    const matches = adapterSource.match(/\.user\.update\(/g) || [];
    expect(matches).toHaveLength(2);
  });

  it("E3: no scim* column writes from the adapter", () => {
    const scimColumnWrites =
      adapterSource.match(
        /scim(UserName|ExternalId|Extensions|GivenName|FamilyName)/g
      ) || [];
    expect(scimColumnWrites).toHaveLength(0);
  });
});
