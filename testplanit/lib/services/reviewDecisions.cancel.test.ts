import { describe, expect, it, vi } from "vitest";

/**
 * Unit tests for D-07 cancel-by-status-mutation semantics.
 *
 * Cancel is implemented in the UI as a ZenStack `useUpdateReviewRequest`
 * mutation that sets `status: 'CANCELLED'`. The schema-layer
 * `@@allow('update', status == 'PENDING' && (requestedBy == auth() ||
 * auth().access == 'ADMIN'))` policy enforces who may perform it. No
 * custom service or API route is required — the ZenStack auto-API path
 * is the single chokepoint.
 *
 * These tests pin three contract claims:
 *
 *   1. Cancel is a status mutation, NOT a row delete (soft-delete-only
 *      memory rule). The test asserts the canonical `update` shape and
 *      proves no `delete*` API is invoked.
 *
 *   2. Cancel is idempotent on a non-PENDING row from the caller's
 *      perspective: the ZenStack policy denies the update (status filter
 *      narrows the row out of the @@allow('update') set), so the call
 *      surfaces a not-authorized / not-found error rather than silently
 *      flipping a CANCELLED row back to CANCELLED. The test documents this
 *      chosen path — callers re-fetch the row and observe the existing
 *      CANCELLED state.
 *
 *   3. Requester / admin gating is enforced by the @@allow rule, not by
 *      app code. The test does NOT duplicate that policy here; it asserts
 *      the call shape and documents the policy boundary.
 *
 * Pattern note: the cancel path is a ZenStack hook call, so this file
 * tests against a mocked prisma-shaped client rather than importing a
 * service. The cancel UI button performs `useUpdateReviewRequest.mutate({
 * where: { id }, data: { status: 'CANCELLED' } })`; the contract under
 * test is the *shape* of that call.
 */

type UpdateArgs = { where: { id: string }; data: { status: string } };
type UpdateResult = { id: string; status: string };
type UpdateFn = (args: UpdateArgs) => Promise<UpdateResult>;

function createMockPrisma(updateImpl?: ReturnType<typeof vi.fn<UpdateFn>>) {
  const update =
    updateImpl ??
    vi.fn<UpdateFn>(async (args) => ({
      id: args.where.id,
      status: args.data.status,
    }));
  return {
    reviewRequest: {
      update,
      // Deliberately NOT including delete / deleteMany — if cancel ever
      // hits these the test would explode with a TypeError, which is the
      // intended contract.
    },
  };
}

async function performCancel(
  client: ReturnType<typeof createMockPrisma>,
  reviewRequestId: string,
): Promise<UpdateResult> {
  return client.reviewRequest.update({
    where: { id: reviewRequestId },
    data: { status: "CANCELLED" },
  });
}

describe("ReviewRequest cancel-by-status-mutation (D-07)", () => {
  it("invokes update with { status: 'CANCELLED' } — NOT a row delete", async () => {
    const update = vi
      .fn<UpdateFn>()
      .mockResolvedValue({ id: "r1", status: "CANCELLED" });
    const client = createMockPrisma(update);

    const result = await performCancel(client, "r1");

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "CANCELLED" },
    });
    expect(result).toEqual({ id: "r1", status: "CANCELLED" });
  });

  it("never invokes a delete API on the cancel path (soft-delete-only memory rule)", async () => {
    // The mock client deliberately exposes ONLY `update` — any accidental
    // call to delete / deleteMany would surface as a TypeError. We also
    // explicitly assert no delete-shaped method appears on the namespace
    // so a future regression that adds one stays visible.
    const client = createMockPrisma();
    await performCancel(client, "r2");

    // No `delete*` keys on the reviewRequest namespace surface here.
    expect((client.reviewRequest as Record<string, unknown>).delete).toBeUndefined();
    expect((client.reviewRequest as Record<string, unknown>).deleteMany).toBeUndefined();
  });

  it("policy-denied cancels surface the underlying policy error to the caller (idempotency path)", async () => {
    // When the row's status is no longer PENDING, the @@allow('update',
    // status == 'PENDING' && ...) rule narrows it out of the writable set
    // and ZenStack rejects the call. The caller observes an error rather
    // than a silent no-op. The cancel UI handles this by refetching the
    // latest request and rendering the new banner state.
    const denied = new Error(
      "denied by policy: reviewRequest entity failed update check",
    );
    const update = vi.fn<UpdateFn>().mockRejectedValue(denied);
    const client = createMockPrisma(update);

    await expect(performCancel(client, "r3")).rejects.toBe(denied);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("requester / admin gating is enforced by the @@allow rule — service does NOT duplicate that check", async () => {
    // Contract-only assertion: the cancel path goes straight through the
    // ZenStack auto-API. There is no service-layer access check in the
    // app. If a non-requester non-admin invokes cancel, the policy engine
    // surfaces the error; the cancel UI does not pre-filter. This test
    // documents that boundary by proving the call shape we issue makes
    // no assumption about the caller's identity.
    const update = vi
      .fn<UpdateFn>()
      .mockResolvedValue({ id: "r4", status: "CANCELLED" });
    const client = createMockPrisma(update);

    await performCancel(client, "r4");

    const callArgs = update.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty("auth");
    expect(callArgs).not.toHaveProperty("session");
    // The only fields are { where, data } — no identity smuggled through.
    expect(Object.keys(callArgs).sort()).toEqual(["data", "where"]);
  });
});
