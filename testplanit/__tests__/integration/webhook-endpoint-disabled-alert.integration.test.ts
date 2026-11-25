/**
 * Live-DB proof of who is told when an outbound webhook endpoint is switched
 * off: the tenth failure in a row disables it, and the project's creator and
 * its active project administrators are told; when none of them is an active
 * user, the active system administrators are.
 *
 * Run against a seeded scratch database, never the default .env one:
 *   cd testplanit && DATABASE_URL=<scratch tpi_* URL> RUN_DB_INTEGRATION=1 \
 *     pnpm exec vitest run __tests__/integration/webhook-endpoint-disabled-alert.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { SYSTEM_AUTOMATION_USER_ID } from "~/lib/automationUser";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("~/lib/services/notificationService", () => ({
  NotificationService: {
    createWebhookEndpointDisabledNotification: mocks.create,
  },
}));

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const describeIntegration =
  RUN_INTEGRATION && process.env.DATABASE_URL ? describe : describe.skip;

const STAMP = `wed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describeIntegration(
  "Telling administrators that a webhook endpoint was disabled (live DB)",
  () => {
    let db: any;
    let transition: typeof import("~/lib/webhooks/health").transition;
    let notifyEndpointDisabled: typeof import("~/lib/webhooks/endpointDisabledAlert").notifyEndpointDisabled;

    const fx = {
      projectId: 0,
      configId: "",
      creatorId: "",
      adminId: "",
      lapsedId: "",
      outsiderId: "",
    };
    const userIds = () =>
      [fx.creatorId, fx.adminId, fx.lapsedId, fx.outsiderId].filter(Boolean);
    const told = () =>
      mocks.create.mock.calls
        .map((call) => (call[0] as { userId: string }).userId)
        .sort();

    beforeAll(async () => {
      process.env.NEXTAUTH_URL ??= "https://tpi.example.com";
      ({ rawDb: db } = await import("~/lib/rawDb"));
      const rows: { name: string }[] =
        await db.$queryRaw`select current_database() as name`;
      const dbName = rows[0]?.name ?? "";
      if (!dbName.startsWith("tpi_")) {
        throw new Error(
          `Refusing to run against database "${dbName}": this suite only runs against a tpi_* scratch database.`
        );
      }
      ({ transition } = await import("~/lib/webhooks/health"));
      ({ notifyEndpointDisabled } =
        await import("~/lib/webhooks/endpointDisabledAlert"));

      const role = await db.roles.findFirst({ select: { id: true } });
      if (!role) throw new Error("Seed the database first (roles)");
      const person = async (
        label: string,
        access: "USER" | "PROJECTADMIN",
        isActive: boolean
      ): Promise<string> =>
        (
          await db.user.create({
            data: {
              name: `${label} ${STAMP}`,
              email: `${label}-${STAMP}@example.test`,
              access,
              isActive,
              roleId: role.id,
            },
            select: { id: true },
          })
        ).id;
      fx.creatorId = await person("creator", "USER", true);
      fx.adminId = await person("padmin", "PROJECTADMIN", true);
      fx.lapsedId = await person("lapsed", "PROJECTADMIN", false);
      // A project administrator of some other project is not told.
      fx.outsiderId = await person("outsider", "PROJECTADMIN", true);

      const project = await db.projects.create({
        data: {
          name: `Endpoint alert ${STAMP}`,
          createdBy: fx.creatorId,
          assignedUsers: {
            create: [{ userId: fx.adminId }, { userId: fx.lapsedId }],
          },
        },
        select: { id: true },
      });
      fx.projectId = project.id;

      const config = await db.webhookConfig.create({
        data: {
          projectId: fx.projectId,
          adapterType: "GENERIC_HMAC",
          direction: "OUTBOUND",
          token: `tok-${STAMP}`,
          secret: "unused",
          name: "Release channel",
          endpointHealth: "DEGRADED",
          consecutiveFailureCount: 9,
        },
        select: { id: true },
      });
      fx.configId = config.id;
    });

    afterAll(async () => {
      if (!db) return;
      if (fx.projectId) {
        await db.projects
          .delete({ where: { id: fx.projectId } })
          .catch((e: unknown) => console.warn("cleanup project", e));
      }
      if (userIds().length > 0) {
        await db.user
          .deleteMany({ where: { id: { in: userIds() } } })
          .catch((e: unknown) => console.warn("cleanup users", e));
      }
    });

    it("disables the endpoint on the tenth failure in a row and tells the creator and the active project administrators", async () => {
      expect(await transition(fx.configId, "failure", db)).toEqual({
        from: "DEGRADED",
        to: "DISABLED",
        counter: 10,
      });

      expect(
        await notifyEndpointDisabled(db, { webhookConfigId: fx.configId })
      ).toBe(2);

      expect(told()).toEqual([fx.creatorId, fx.adminId].sort());
      expect(mocks.create.mock.calls[0][0]).toMatchObject({
        webhookConfigId: fx.configId,
        endpointName: "Release channel",
        projectId: fx.projectId,
        projectName: `Endpoint alert ${STAMP}`,
      });
    });

    it("tells the active system administrators when nobody on the project is an active user", async () => {
      await db.user.updateMany({
        where: { id: { in: [fx.creatorId, fx.adminId] } },
        data: { isActive: false },
      });
      mocks.create.mockClear();
      const admins: { id: string }[] = await db.user.findMany({
        where: {
          access: "ADMIN",
          isActive: true,
          isDeleted: false,
          id: { not: SYSTEM_AUTOMATION_USER_ID },
        },
        select: { id: true },
      });
      expect(admins.length).toBeGreaterThan(0);

      expect(
        await notifyEndpointDisabled(db, { webhookConfigId: fx.configId })
      ).toBe(admins.length);
      expect(told()).toEqual(admins.map((admin) => admin.id).sort());
    });

    it("stays disabled on the next failure, which the worker reads as nothing new to tell", async () => {
      expect(await transition(fx.configId, "failure", db)).toEqual({
        from: "DISABLED",
        to: "DISABLED",
        counter: 11,
      });
    });
  }
);
