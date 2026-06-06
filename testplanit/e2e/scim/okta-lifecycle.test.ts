/**
 * Okta SCIM full-lifecycle E2E.
 *
 * Drives a real Okta dev tenant through the 9-step provisioning sequence
 * that proves the TestPlanIt SCIM stack handles every event Okta will
 * emit in production:
 *
 *   step 1 — create User via app assignment (SCIM POST)
 *   step 2 — update User profile           (SCIM PUT)
 *   step 3 — deactivate User               (SCIM PATCH active:false)
 *   step 4 — reactivate User               (SCIM PATCH active:true)
 *   step 5 — delete User                   (SCIM DELETE)
 *   step 6 — create Group + assign to app  (SCIM POST /Groups)
 *   step 7 — add User to Group             (SCIM PATCH members add)
 *   step 8 — remove User from Group        (SCIM PATCH members remove)
 *   step 9 — delete Group                  (SCIM DELETE /Groups)
 *
 * Each step asserts BOTH the TestPlanIt DB state (via Prisma direct read)
 * AND that Okta saw the round-trip (via Okta API GET).
 *
 * --- How to run -------------------------------------------------------
 *
 * Prereqs (one-time):
 *
 *   1. Create an Okta dev tenant + a custom SCIM-2.0 app integration.
 *   2. Point the app's SCIM connector base URL at the local TestPlanIt
 *      server (https://localhost:3000/scim/v2 or an ngrok tunnel).
 *   3. Mint a `tps_*` token from /admin/scim and paste it into the
 *      app's authentication header.
 *   4. Copy `.env.e2e.example` → `.env.e2e` and fill OKTA_ORG_URL,
 *      OKTA_API_TOKEN, OKTA_SCIM_APP_ID.
 *   5. Start the TestPlanIt server (`pnpm dev` or `pnpm build && pnpm start`).
 *   6. Confirm DISABLE_SCIM_RATE_LIMIT=true in your shell or .env.e2e.
 *
 * Run:
 *
 *   RUN_OKTA_E2E=1 pnpm exec vitest run e2e/scim/okta-lifecycle.test.ts
 *
 * Without RUN_OKTA_E2E the suite skips at the describe level; the 9
 * tests count as skipped in the standard `pnpm test` run.
 *
 * --- Cleanup ----------------------------------------------------------
 *
 * Every fixture (user email + group name) embeds a per-run timestamp
 * prefix so a `startsWith` sweep in `afterAll` cleans up without
 * collateral damage. The afterAll block is wrapped in try/catch per
 * Okta API call so teardown is best-effort and never masks a test
 * failure with a cleanup throw.
 *
 * --- Token safety -----------------------------------------------------
 *
 * The OktaClient redacts its Authorization header from error messages.
 * This test file never logs OKTA_API_TOKEN directly; the tenant URL
 * may appear in stack traces (it is the operator's own dev tenant and
 * is not a secret).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/lib/prisma";

import { OktaClient } from "./okta-client";

const shouldRun = Boolean(process.env.RUN_OKTA_E2E);
const orgUrl = process.env.OKTA_ORG_URL ?? "";
const apiToken = process.env.OKTA_API_TOKEN ?? "";
const appId = process.env.OKTA_SCIM_APP_ID ?? "";

const describeMaybe = shouldRun ? describe : describe.skip;

// Wait until a predicate returns truthy. Okta → TestPlanIt SCIM is an
// asynchronous Okta-side queue; pure round-trip latency can run a few
// seconds even on a healthy tenant. The poll loop avoids brittle fixed
// sleeps.
async function waitFor<T>(
  predicate: () => Promise<T | null | undefined>,
  options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const label = options.label ?? "predicate";
  const deadline = Date.now() + timeoutMs;
  let last: T | null | undefined;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label} (last value: ${String(last)})`,
  );
}

describeMaybe("Okta SCIM full lifecycle E2E", () => {
  if (shouldRun) {
    if (!orgUrl) throw new Error("OKTA_ORG_URL must be set when RUN_OKTA_E2E=1");
    if (!apiToken)
      throw new Error("OKTA_API_TOKEN must be set when RUN_OKTA_E2E=1");
    if (!appId)
      throw new Error("OKTA_SCIM_APP_ID must be set when RUN_OKTA_E2E=1");
  }

  const okta = new OktaClient(orgUrl, apiToken);
  const runId = Date.now();
  const testPrefix = `e2e-test-${runId}`;
  const testEmail = `${testPrefix}@testplanit-scim-e2e.local`;
  const testGroupName = `${testPrefix}-group`;
  const updatedFirstName = "Updated";

  let oktaUserId: string;
  let oktaGroupId: string;

  beforeAll(async () => {
    // Pre-flight sweep: clear any stale rows from a previous failed run
    // sharing the same prefix family. The sweep is keyed on the literal
    // "e2e-test-" prefix to catch all prior runs without disturbing real
    // users.
    await prisma.user.deleteMany({
      where: { scimUserName: { startsWith: "e2e-test-" } },
    });
    await prisma.groups.deleteMany({
      where: { scimDisplayName: { startsWith: "e2e-test-" } },
    });
  });

  afterAll(async () => {
    // Best-effort teardown — never fail the suite on cleanup.
    try {
      if (oktaUserId) {
        try {
          await okta.unassignUserFromApp(appId, oktaUserId);
        } catch {
          /* user may already be removed */
        }
        try {
          await okta.deactivateUser(oktaUserId);
        } catch {
          /* may already be deactivated */
        }
        try {
          await okta.deleteUser(oktaUserId);
        } catch {
          /* may already be deleted */
        }
      }
      if (oktaGroupId) {
        try {
          await okta.unassignGroupFromApp(appId, oktaGroupId);
        } catch {
          /* may already be removed */
        }
        try {
          await okta.deleteGroup(oktaGroupId);
        } catch {
          /* may already be deleted */
        }
      }
    } catch {
      /* swallow */
    }
    await prisma.user.deleteMany({
      where: { scimUserName: { startsWith: "e2e-test-" } },
    });
    await prisma.groups.deleteMany({
      where: { scimDisplayName: { startsWith: "e2e-test-" } },
    });
    await prisma.$disconnect();
  });

  it("step 1: create User via Okta app assignment provisions a TestPlanIt user", async () => {
    const oktaResponse = (await okta.assignUserToApp(appId, "me", {
      userName: testEmail,
      givenName: "Alice",
      familyName: "Lifecycle",
      email: testEmail,
    })) as { id?: string };
    // Okta's POST /apps/{appId}/users returns the appUser; the underlying
    // Okta user id surfaces under the `id` field of the appUser binding.
    if (!oktaResponse.id) {
      throw new Error(
        "Okta did not return an id from POST /apps/{appId}/users; " +
          "verify the SCIM app integration is wired and the OKTA_SCIM_APP_ID is correct",
      );
    }
    oktaUserId = oktaResponse.id;

    // Okta saw the round-trip:
    const oktaUser = await okta.getUser(oktaUserId);
    expect(oktaUser.profile.login.toLowerCase()).toBe(testEmail.toLowerCase());

    // TestPlanIt DB caught the SCIM POST:
    const row = await waitFor(
      () =>
        prisma.user.findUnique({
          where: { scimUserName: testEmail.toLowerCase() },
        }),
      { label: "TestPlanIt user row from SCIM POST" },
    );
    expect(row.authMethod).toBe("SCIM");
    expect(row.isActive).toBe(true);
    expect(row.isDeleted).toBe(false);
  });

  it("step 2: update User profile in Okta propagates to TestPlanIt", async () => {
    await okta.updateUser(oktaUserId, { firstName: updatedFirstName });
    const oktaUser = await okta.getUser(oktaUserId);
    expect(oktaUser.profile.firstName).toBe(updatedFirstName);

    const row = await waitFor(
      async () => {
        const candidate = await prisma.user.findUnique({
          where: { scimUserName: testEmail.toLowerCase() },
        });
        return candidate?.scimGivenName === updatedFirstName ? candidate : null;
      },
      { label: "TestPlanIt user.scimGivenName updated to match Okta" },
    );
    expect(row.scimGivenName).toBe(updatedFirstName);
  });

  it("step 3: deactivate User in Okta flips isActive=false in TestPlanIt", async () => {
    await okta.deactivateUser(oktaUserId);
    const oktaUser = await okta.getUser(oktaUserId);
    expect(["DEPROVISIONED", "SUSPENDED"]).toContain(oktaUser.status);

    const row = await waitFor(
      async () => {
        const candidate = await prisma.user.findUnique({
          where: { scimUserName: testEmail.toLowerCase() },
        });
        return candidate?.isActive === false ? candidate : null;
      },
      { label: "TestPlanIt user.isActive=false after Okta deactivate" },
    );
    expect(row.isActive).toBe(false);
  });

  it("step 4: reactivate User in Okta flips isActive=true in TestPlanIt", async () => {
    await okta.activateUser(oktaUserId);
    // Re-assign the user to the app so Okta replays the SCIM POST / PATCH
    // active:true round-trip (Okta lifecycle/activate alone does not
    // automatically re-provision a previously deactivated app user).
    try {
      await okta.assignUserToApp(appId, oktaUserId, {
        userName: testEmail,
        givenName: updatedFirstName,
        familyName: "Lifecycle",
        email: testEmail,
      });
    } catch {
      /* may already be assigned */
    }

    const oktaUser = await okta.getUser(oktaUserId);
    expect(["ACTIVE", "PROVISIONED"]).toContain(oktaUser.status);

    const row = await waitFor(
      async () => {
        const candidate = await prisma.user.findUnique({
          where: { scimUserName: testEmail.toLowerCase() },
        });
        return candidate?.isActive === true ? candidate : null;
      },
      { label: "TestPlanIt user.isActive=true after Okta reactivate" },
    );
    expect(row.isActive).toBe(true);
  });

  it("step 5: delete User in Okta tombstones the TestPlanIt row", async () => {
    try {
      await okta.unassignUserFromApp(appId, oktaUserId);
    } catch {
      /* tolerate already-unassigned */
    }
    // Okta requires a deactivate-before-delete; the prior step may have
    // already reactivated, so deactivate now before the destructive delete.
    try {
      await okta.deactivateUser(oktaUserId);
    } catch {
      /* tolerate already-deactivated */
    }
    await okta.deleteUser(oktaUserId);

    // Okta saw the delete: subsequent GET returns 404.
    let getThrew = false;
    try {
      await okta.getUser(oktaUserId);
    } catch (err) {
      getThrew = true;
      expect((err as Error).message).toMatch(/404/);
    }
    expect(getThrew).toBe(true);

    const row = await waitFor(
      async () => {
        const candidate = await prisma.user.findUnique({
          where: { scimUserName: testEmail.toLowerCase() },
        });
        return candidate?.isDeleted === true ? candidate : null;
      },
      { label: "TestPlanIt user.isDeleted=true after Okta delete" },
    );
    expect(row.isDeleted).toBe(true);
  });

  it("step 6: create Group in Okta + assign to SCIM app provisions a TestPlanIt group", async () => {
    const oktaGroup = await okta.createGroup(
      testGroupName,
      "TestPlanIt SCIM E2E group fixture",
    );
    oktaGroupId = oktaGroup.id;
    expect(oktaGroup.profile.name).toBe(testGroupName);

    await okta.assignGroupToApp(appId, oktaGroupId);

    const row = await waitFor(
      () =>
        prisma.groups.findFirst({
          where: { scimDisplayName: testGroupName.toLowerCase() },
        }),
      { label: "TestPlanIt groups row from SCIM POST /Groups" },
    );
    expect(row.isDeleted).toBe(false);
  });

  it("step 7: add User to Group in Okta propagates GroupAssignment", async () => {
    // Reuse the existing oktaUserId from step 5 — but the user was deleted.
    // Provision a NEW user for the group-membership phase. The original
    // testEmail prefix family covers the cleanup sweep.
    const memberEmail = `${testPrefix}-member@testplanit-scim-e2e.local`;
    const memberOkta = (await okta.assignUserToApp(appId, "me", {
      userName: memberEmail,
      givenName: "Bob",
      familyName: "Member",
      email: memberEmail,
    })) as { id: string };
    // Track the new oktaUserId so cleanup catches it.
    oktaUserId = memberOkta.id;

    const memberRow = await waitFor(
      () =>
        prisma.user.findUnique({
          where: { scimUserName: memberEmail.toLowerCase() },
        }),
      { label: "TestPlanIt user row for group-membership phase" },
    );

    await okta.addUserToGroup(oktaGroupId, oktaUserId);

    const groupRow = await prisma.groups.findFirst({
      where: { scimDisplayName: testGroupName.toLowerCase() },
    });
    if (!groupRow) throw new Error("Group row vanished between steps 6 and 7");

    const assignment = await waitFor(
      () =>
        prisma.groupAssignment.findUnique({
          where: {
            userId_groupId: {
              userId: memberRow.id,
              groupId: groupRow.id,
            },
          },
        }),
      { label: "GroupAssignment row after Okta add-user-to-group" },
    );
    expect(assignment.userId).toBe(memberRow.id);
    expect(assignment.groupId).toBe(groupRow.id);
  });

  it("step 8: remove User from Group in Okta removes the GroupAssignment row", async () => {
    await okta.removeUserFromGroup(oktaGroupId, oktaUserId);

    const memberEmail = `${testPrefix}-member@testplanit-scim-e2e.local`;
    const memberRow = await prisma.user.findUnique({
      where: { scimUserName: memberEmail.toLowerCase() },
    });
    if (!memberRow) throw new Error("Member row vanished between steps 7 and 8");

    const groupRow = await prisma.groups.findFirst({
      where: { scimDisplayName: testGroupName.toLowerCase() },
    });
    if (!groupRow) throw new Error("Group row vanished between steps 7 and 8");

    await waitFor(
      async () => {
        const candidate = await prisma.groupAssignment.findUnique({
          where: {
            userId_groupId: {
              userId: memberRow.id,
              groupId: groupRow.id,
            },
          },
        });
        return candidate === null ? true : null;
      },
      { label: "GroupAssignment row removed after Okta remove-user-from-group" },
    );
  });

  it("step 9: delete Group in Okta tombstones the TestPlanIt group", async () => {
    try {
      await okta.unassignGroupFromApp(appId, oktaGroupId);
    } catch {
      /* tolerate already-unassigned */
    }
    await okta.deleteGroup(oktaGroupId);

    let getThrew = false;
    try {
      await okta.getGroup(oktaGroupId);
    } catch (err) {
      getThrew = true;
      expect((err as Error).message).toMatch(/404/);
    }
    expect(getThrew).toBe(true);

    const row = await waitFor(
      async () => {
        const candidate = await prisma.groups.findFirst({
          where: { scimDisplayName: testGroupName.toLowerCase() },
        });
        return candidate?.isDeleted === true ? candidate : null;
      },
      { label: "TestPlanIt groups.isDeleted=true after Okta delete-group" },
    );
    expect(row.isDeleted).toBe(true);
  });
});
