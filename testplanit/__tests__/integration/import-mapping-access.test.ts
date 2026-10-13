// Access-policy contract for ImportMapping (saved CSV import column mappings).
//
// A mapping is private to its creator unless shared. A shared mapping with a
// template is readable by anyone who can reach a project using that template;
// a shared mapping without one is readable by everyone. Only the creator and
// system admins can change or delete a mapping.
//
// Run via:
//   cd testplanit && RUN_DB_INTEGRATION=1 pnpm test import-mapping-access --run

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRawDbClient } from "~/lib/rawDbClient";
import { getAuthDb } from "~/lib/zenstack";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

const db = createRawDbClient();
const TAG = `ima-${Date.now()}`;

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

const config = {
  version: 1,
  columns: [{ column: "Title", field: "name" }],
  settings: { delimiter: "," },
};

interface Fixture {
  projectIds: number[];
  templateId: number;
  owner: AuthUser;
  member: AuthUser; // reaches a project that uses the template
  otherProjectUser: AuthUser; // only reaches a project without the template
  blocked: AuthUser; // NO_ACCESS on the template's project
  admin: AuthUser;
  privateId: string;
  sharedTemplateId: string;
  sharedStepsId: string;
}

let fixture: Fixture | undefined;

async function setupFixture(): Promise<Fixture> {
  const role = await db.roles.create({
    data: {
      name: `${TAG}-role`,
      rolePermissions: {
        create: [{ area: "TestCaseRepository", canAddEdit: true }],
      },
    },
  });

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
  const member = await mkUser("member");
  const otherProjectUser = await mkUser("other");
  const blocked = await mkUser("blocked");
  const admin = await mkUser("admin", "ADMIN");

  const template = await db.templates.create({
    data: {
      templateName: `${TAG}-template`,
      isEnabled: true,
      isDefault: false,
    },
  });

  // The template's project admits only assigned users; the other project
  // admits only otherProjectUser and doesn't use the template.
  const templateProject = await db.projects.create({
    data: {
      name: `${TAG}-with-template`,
      createdBy: owner.id,
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
    },
  });
  const otherProject = await db.projects.create({
    data: {
      name: `${TAG}-without-template`,
      createdBy: owner.id,
      defaultAccessType: "NO_ACCESS",
      defaultRoleId: null,
    },
  });
  await db.templateProjectAssignment.create({
    data: { templateId: template.id, projectId: templateProject.id },
  });
  await db.userProjectPermission.createMany({
    data: [
      {
        userId: member.id,
        projectId: templateProject.id,
        accessType: "GLOBAL_ROLE" as const,
        roleId: null,
      },
      {
        userId: blocked.id,
        projectId: templateProject.id,
        accessType: "NO_ACCESS" as const,
        roleId: null,
      },
      {
        userId: otherProjectUser.id,
        projectId: otherProject.id,
        accessType: "GLOBAL_ROLE" as const,
        roleId: null,
      },
    ],
  });

  const ownerAuth = await fetchAuthUser(owner.id);
  const ownerDb = (await getAuthDb(ownerAuth)) as any;
  const mk = (
    name: string,
    data: Record<string, unknown>
  ): Promise<{ id: string }> =>
    ownerDb.importMapping.create({
      data: { name: `${TAG} ${name}`, config, createdById: owner.id, ...data },
    });

  const privateMapping = await mk("private", {
    wizard: "TEST_CASES",
    templateId: template.id,
  });
  const sharedTemplate = await mk("shared template", {
    wizard: "TEST_CASES",
    templateId: template.id,
    isShared: true,
  });
  const sharedSteps = await mk("shared steps", {
    wizard: "SHARED_STEPS",
    isShared: true,
  });

  return {
    projectIds: [templateProject.id, otherProject.id],
    templateId: template.id,
    owner: ownerAuth,
    member: await fetchAuthUser(member.id),
    otherProjectUser: await fetchAuthUser(otherProjectUser.id),
    blocked: await fetchAuthUser(blocked.id),
    admin: await fetchAuthUser(admin.id),
    privateId: privateMapping.id,
    sharedTemplateId: sharedTemplate.id,
    sharedStepsId: sharedSteps.id,
  };
}

async function teardown() {
  await db.importMapping.deleteMany({ where: { name: { startsWith: TAG } } });
  if (fixture) {
    await db.userProjectPermission.deleteMany({
      where: { projectId: { in: fixture.projectIds } },
    });
    await db.templateProjectAssignment.deleteMany({
      where: { templateId: fixture.templateId },
    });
    await db.projects.deleteMany({ where: { id: { in: fixture.projectIds } } });
    await db.templates.deleteMany({ where: { id: fixture.templateId } });
  }
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.roles.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function readableIds(user: AuthUser): Promise<string[]> {
  const userDb = (await getAuthDb(user)) as any;
  const rows = await userDb.importMapping.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  return rows.map((r: { id: string }) => r.id).sort();
}

describeIntegration("ImportMapping access policy", () => {
  beforeAll(async () => {
    fixture = await setupFixture();
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 60_000);

  it("lets the creator read and update all of their mappings", async () => {
    const f = fixture!;
    expect(await readableIds(f.owner)).toEqual(
      [f.privateId, f.sharedTemplateId, f.sharedStepsId].sort()
    );

    const ownerDb = (await getAuthDb(f.owner)) as any;
    await ownerDb.importMapping.update({
      where: { id: f.privateId },
      data: { isShared: false, description: "still mine" },
    });
  });

  it("shows a shared template mapping to users of a project with that template", async () => {
    const f = fixture!;
    expect(await readableIds(f.member)).toEqual(
      [f.sharedTemplateId, f.sharedStepsId].sort()
    );
  });

  it("hides a shared template mapping from users who can't reach the template", async () => {
    const f = fixture!;
    expect(await readableIds(f.otherProjectUser)).toEqual([f.sharedStepsId]);
    expect(await readableIds(f.blocked)).toEqual([f.sharedStepsId]);
  });

  it("refuses edits to someone else's shared mapping", async () => {
    const f = fixture!;
    const memberDb = (await getAuthDb(f.member)) as any;

    expect(
      await isDenied(() =>
        memberDb.importMapping.update({
          where: { id: f.sharedTemplateId },
          data: { isDeleted: true },
        })
      )
    ).toBe(true);
    const after = await db.importMapping.findUniqueOrThrow({
      where: { id: f.sharedTemplateId },
    });
    expect(after.isDeleted).toBe(false);
  });

  it("lets a system admin edit any mapping", async () => {
    const f = fixture!;
    const adminDb = (await getAuthDb(f.admin)) as any;

    await adminDb.importMapping.update({
      where: { id: f.sharedTemplateId },
      data: { description: "curated by an admin" },
    });
    const after = await db.importMapping.findUniqueOrThrow({
      where: { id: f.sharedTemplateId },
    });
    expect(after.description).toBe("curated by an admin");
  });

  it("refuses to create a mapping on someone else's behalf", async () => {
    const f = fixture!;
    const memberDb = (await getAuthDb(f.member)) as any;

    expect(
      await isDenied(() =>
        memberDb.importMapping.create({
          data: {
            name: `${TAG} forged`,
            wizard: "TEST_CASES",
            config,
            isShared: true,
            createdById: f.owner.id,
          },
        })
      )
    ).toBe(true);
  });
});
