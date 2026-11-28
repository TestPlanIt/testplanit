// Access-policy contract for Passkey (WebAuthn credentials).
//
// A passkey is readable and removable by its owner and by system admins, and
// by no one else. Nobody can create or change one through the model API, not
// even an admin writing through the owner's User row: rows are only written by
// the registration and sign-in routes. The stored public key is never
// readable through the policy client.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test passkey-access --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `pka-${Date.now()}`;

type AuthUser = Awaited<ReturnType<typeof fetchAuthUser>>;

async function fetchAuthUser(userId: string) {
  return db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { role: { include: { rolePermissions: true } } },
  });
}

/** True when the operation was refused, or silently filtered to nothing. */
async function isDenied(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = await fn();
    if (result === null || result === undefined) return true;
    if (Array.isArray(result)) return result.length === 0;
    if (typeof result === "object" && "count" in (result as object))
      return (result as { count: number }).count === 0;
    return false;
  } catch {
    return true;
  }
}

function passkeyData(userId: string, label: string) {
  return {
    userId,
    credentialId: `${TAG}-${label}`,
    userHandle: "dXNlci1oYW5kbGU",
    publicKey: "cHVibGljLWtleQ",
    transports: ["internal"],
    deviceType: "multiDevice",
    name: `${TAG} ${label}`,
  };
}

interface Fixture {
  owner: AuthUser;
  other: AuthUser;
  admin: AuthUser;
  ownerPasskeyId: string;
  otherPasskeyId: string;
}

let fixture: Fixture | undefined;

async function setupFixture(): Promise<Fixture> {
  const role = await db.roles.create({ data: { name: `${TAG}-role` } });
  const mkUser = async (label: string, access: "USER" | "ADMIN" = "USER") =>
    db.user.create({
      data: {
        email: `${TAG}-${label}@example.test`,
        name: `${TAG} ${label}`,
        access,
        roleId: role.id,
      },
    });

  const owner = await mkUser("owner");
  const other = await mkUser("other");
  const admin = await mkUser("admin", "ADMIN");

  const ownerPasskey = await db.passkey.create({
    data: passkeyData(owner.id, "owner"),
  });
  const otherPasskey = await db.passkey.create({
    data: passkeyData(other.id, "other"),
  });

  return {
    owner: await fetchAuthUser(owner.id),
    other: await fetchAuthUser(other.id),
    admin: await fetchAuthUser(admin.id),
    ownerPasskeyId: ownerPasskey.id,
    otherPasskeyId: otherPasskey.id,
  };
}

async function teardown() {
  // Passkeys go with their users.
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.roles.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function readableIds(user: AuthUser | undefined): Promise<string[]> {
  const userDb = (await getAuthDb(user)) as any;
  const rows = await userDb.passkey.findMany({
    where: { credentialId: { startsWith: TAG } },
    select: { id: true },
  });
  return rows.map((row: { id: string }) => row.id).sort();
}

describeIntegration("Passkey access policy", () => {
  beforeAll(async () => {
    fixture = await setupFixture();
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 60_000);

  it("lets a user read only their own passkeys", async () => {
    const f = fixture!;
    expect(await readableIds(f.owner)).toEqual([f.ownerPasskeyId]);
    expect(await readableIds(f.other)).toEqual([f.otherPasskeyId]);
  });

  it("lets an admin read everyone's passkeys", async () => {
    const f = fixture!;
    expect(await readableIds(f.admin)).toEqual(
      [f.ownerPasskeyId, f.otherPasskeyId].sort()
    );
  });

  it("shows nothing to a request with no user", async () => {
    expect(await isDenied(() => readableIds(undefined))).toBe(true);
  });

  it("never returns the stored public key, even when asked for it", async () => {
    const f = fixture!;
    const ownerDb = (await getAuthDb(f.owner)) as any;

    const byDefault = await ownerDb.passkey.findUnique({
      where: { id: f.ownerPasskeyId },
    });
    expect(byDefault.name).toBe(`${TAG} owner`);
    expect(byDefault).not.toHaveProperty("publicKey");
    expect(byDefault).not.toHaveProperty("counter");
    expect(byDefault).not.toHaveProperty("userHandle");

    const askedFor = await ownerDb.passkey.findUnique({
      where: { id: f.ownerPasskeyId },
      omit: { publicKey: false },
    });
    expect(askedFor.publicKey ?? null).toBeNull();
  });

  it("refuses creation through the model API, for owners and admins alike", async () => {
    const f = fixture!;
    for (const user of [f.owner, f.admin]) {
      const userDb = (await getAuthDb(user)) as any;
      expect(
        await isDenied(() =>
          userDb.passkey.create({
            data: passkeyData(f.owner.id, `planted-by-${user.access}`),
          })
        )
      ).toBe(true);
    }
    expect(
      await db.passkey.count({
        where: { credentialId: { startsWith: `${TAG}-planted` } },
      })
    ).toBe(0);
  });

  it("refuses an admin planting a passkey through the owner's User row", async () => {
    const f = fixture!;
    const adminDb = (await getAuthDb(f.admin)) as any;

    expect(
      await isDenied(() =>
        adminDb.user.update({
          where: { id: f.owner.id },
          data: {
            passkeys: {
              create: {
                credentialId: `${TAG}-nested`,
                userHandle: "dXNlci1oYW5kbGU",
                publicKey: "cHVibGljLWtleQ",
                deviceType: "multiDevice",
                name: `${TAG} nested`,
              },
            },
          },
        })
      )
    ).toBe(true);
    expect(
      await db.passkey.count({ where: { credentialId: `${TAG}-nested` } })
    ).toBe(0);
  });

  it("refuses updates and upserts, for owners and admins alike", async () => {
    const f = fixture!;
    for (const user of [f.owner, f.admin]) {
      const userDb = (await getAuthDb(user)) as any;
      expect(
        await isDenied(() =>
          userDb.passkey.update({
            where: { id: f.ownerPasskeyId },
            data: { name: "renamed" },
          })
        )
      ).toBe(true);
      expect(
        await isDenied(() =>
          userDb.passkey.upsert({
            where: { id: f.ownerPasskeyId },
            update: { userId: f.other.id },
            create: passkeyData(f.other.id, "upserted"),
          })
        )
      ).toBe(true);
    }

    const untouched = await db.passkey.findUniqueOrThrow({
      where: { id: f.ownerPasskeyId },
    });
    expect(untouched.name).toBe(`${TAG} owner`);
    expect(untouched.userId).toBe(f.owner.id);
  });

  it("refuses removal of someone else's passkey", async () => {
    const f = fixture!;
    const otherDb = (await getAuthDb(f.other)) as any;

    expect(
      await isDenied(() =>
        otherDb.passkey.delete({ where: { id: f.ownerPasskeyId } })
      )
    ).toBe(true);
    expect(await db.passkey.count({ where: { id: f.ownerPasskeyId } })).toBe(1);
  });

  it("lets an admin remove another user's passkey", async () => {
    const f = fixture!;
    const adminDb = (await getAuthDb(f.admin)) as any;

    await adminDb.passkey.delete({ where: { id: f.otherPasskeyId } });
    expect(await db.passkey.count({ where: { id: f.otherPasskeyId } })).toBe(0);
  });

  it("lets a user remove their own passkey", async () => {
    const f = fixture!;
    const ownerDb = (await getAuthDb(f.owner)) as any;

    await ownerDb.passkey.delete({ where: { id: f.ownerPasskeyId } });
    expect(await db.passkey.count({ where: { id: f.ownerPasskeyId } })).toBe(0);
  });
});
