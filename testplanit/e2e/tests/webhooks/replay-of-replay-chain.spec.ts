import { PrismaClient } from "@prisma/client";

import { expect, test } from "../../fixtures/index";
import {
  seedOutboundConfig,
  seedReplayChain,
} from "../../fixtures/webhooks-seed";

/**
 * Long replay-of-replay-of-replay chain (L-03).
 *
 * Verifies that:
 *   1. Each replay row's `replayedFromDeliveryId` points at the IMMEDIATE
 *      PARENT, not transitively at the original. The schema's
 *      `replays` self-relation produces a tree where each child's FK names
 *      its direct parent — there is no transitive close column. A bug here
 *      would surface as later children pointing at the root instead of the
 *      previous link.
 *   2. All N rows are queryable in one shot via a recursive walk from the
 *      latest child back to the root, proving no ID is dropped.
 *   3. The chain survives an `onDelete: SetNull` purge of the original.
 *      Phase 2's schema sets `WebhookDelivery.replayedFromDeliveryId` to
 *      `onDelete: SetNull` so a 30-day retention purge of the root row
 *      breaks the link cleanly without cascading. After purging row 0, row
 *      1's FK becomes null but rows 2..N still chain back to row 1
 *      (and indirectly through it) — no FK-violation, no cascade-deletion.
 *
 * The chain is seeded directly via the `seedReplayChain` helper rather than
 * driving 6 dispatches through the BullMQ retry curve (Phase 2 D-21
 * schedules ~21h per event — incompatible with E2E budgets). The seed
 * mirrors the exact column shape `replayDelivery` would write at attempt-
 * completion time (Plan 04-05 wired `replayedFromDeliveryId` onto the new
 * row + threaded the ORIGINAL eventId across the chain so the outbox row
 * is reachable from any link).
 */

const CHAIN_DEPTH = 6; // 1 original + 5 replays per L-03 ("repeat 5 times")

test.use({ storageState: "e2e/.auth/admin.json" });
test.describe.configure({ mode: "serial" });

test.describe("Replay-of-replay chain integrity (L-03)", () => {
  let projectId: number;
  let prisma: PrismaClient;
  let configId: string;

  test.beforeAll(async ({ api }) => {
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    projectId = await api.createProject(`E2E Replay Chain ${uniqueId}`);
    prisma = new PrismaClient();
    const seededConfig = await seedOutboundConfig(prisma, {
      projectId,
      url: "https://example.com/L03/replay-chain",
    });
    configId = seededConfig.configId;
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  test("each replay's replayedFromDeliveryId points at the IMMEDIATE PARENT (not transitively at the root)", async () => {
    let chain: Awaited<ReturnType<typeof seedReplayChain>> | undefined;

    await test.step("Seed a 6-link replay chain", async () => {
      chain = await seedReplayChain(prisma, {
        webhookConfigId: configId,
        projectId,
        adapterType: "GENERIC_HMAC",
        depth: CHAIN_DEPTH,
      });
      expect(chain).toHaveLength(CHAIN_DEPTH);
    });

    await test.step("Verify each link's parent is its immediate predecessor", async () => {
      // Row 0 is the original — null parent.
      expect(chain![0]!.replayedFromDeliveryId).toBeNull();

      // Each subsequent row's parent is the IMMEDIATE predecessor in the
      // chain, NOT row 0. This is the contract that distinguishes a linear
      // chain from a "fan from root" anti-pattern.
      for (let i = 1; i < chain!.length; i++) {
        expect(chain![i]!.replayedFromDeliveryId).toBe(chain![i - 1]!.id);
        // Defensive — none of the children should accidentally point at the
        // root once we're past row 1 (where root IS the immediate parent).
        if (i >= 2) {
          expect(chain![i]!.replayedFromDeliveryId).not.toBe(chain![0]!.id);
        }
      }
    });

    await test.step("Confirm all 6 rows are returned by the tenant-scoped query", async () => {
      // All 6 rows visible via a single tenant-scoped query — admin's
      // Deliveries tab uses this exact filter.
      const allRows = await prisma.webhookDelivery.findMany({
        where: { webhookConfigId: configId },
        orderBy: { receivedAt: "asc" },
        select: { id: true, replayedFromDeliveryId: true },
      });
      expect(allRows).toHaveLength(CHAIN_DEPTH);
      const ids = new Set(allRows.map((r) => r.id));
      for (const row of chain!) {
        expect(ids.has(row.id)).toBe(true);
      }
    });
  });

  test("walking the chain from leaf to root via replayedFromDeliveryId returns all 6 rows in order", async () => {
    // Independent verification — start at the leaf and walk up via
    // replayedFromDeliveryId. The walk must reach the root in exactly
    // CHAIN_DEPTH-1 hops; each intermediate node must be a valid row.
    type SeededRow = {
      id: string;
      replayedFromDeliveryId: string | null;
    };
    let byId: Map<string, SeededRow> | undefined;
    let leaf: SeededRow | undefined;
    let walked: string[] | undefined;

    await test.step("Load the seeded chain and locate the leaf", async () => {
      const seeded = await prisma.webhookDelivery.findMany({
        where: { webhookConfigId: configId },
        orderBy: { receivedAt: "asc" },
        select: { id: true, replayedFromDeliveryId: true },
      });
      byId = new Map(seeded.map((r) => [r.id, r]));
      leaf = seeded[seeded.length - 1]!;
    });

    await test.step("Walk leaf-to-root and confirm all 6 rows are reachable", async () => {
      walked = [leaf!.id];
      let cur: SeededRow | undefined = leaf;
      while (cur && cur.replayedFromDeliveryId) {
        const parentId = cur.replayedFromDeliveryId;
        const parent = byId!.get(parentId);
        expect(parent).toBeDefined();
        walked.push(parentId);
        cur = parent;
      }
      expect(walked).toHaveLength(CHAIN_DEPTH);
      // Last element of the walk is the root (replayedFromDeliveryId === null).
      expect(
        byId!.get(walked[walked.length - 1]!)!.replayedFromDeliveryId
      ).toBe(null);
    });
  });

  test("after retention purge of the root row, the rest of the chain remains intact (onDelete: SetNull)", async () => {
    let rootId: string | undefined;

    await test.step("Confirm the chain is intact before the purge", async () => {
      // Pre-purge — confirm chain still reads the way the previous test left it.
      const before = await prisma.webhookDelivery.findMany({
        where: { webhookConfigId: configId },
        orderBy: { receivedAt: "asc" },
        select: { id: true, replayedFromDeliveryId: true },
      });
      expect(before).toHaveLength(CHAIN_DEPTH);
      rootId = before[0]!.id;
    });

    await test.step("Hard-delete the root row to simulate the 30-day retention purge", async () => {
      // Simulate the 30-day retention purge — hard-delete the root row. The
      // schema's `onDelete: SetNull` on `replayedFromDeliveryId` should leave
      // the (former) immediate child with a null parent rather than cascading
      // the delete to all descendants.
      await prisma.webhookDelivery.delete({ where: { id: rootId! } });
    });

    await test.step("Verify the remaining chain stays linked with a null root FK", async () => {
      const after = await prisma.webhookDelivery.findMany({
        where: { webhookConfigId: configId },
        orderBy: { receivedAt: "asc" },
        select: { id: true, replayedFromDeliveryId: true },
      });
      expect(after).toHaveLength(CHAIN_DEPTH - 1);
      // The (former) immediate child of the deleted root now has a null FK;
      // every other descendant still points at its (still-extant) parent.
      expect(after[0]!.replayedFromDeliveryId).toBeNull();
      for (let i = 1; i < after.length; i++) {
        expect(after[i]!.replayedFromDeliveryId).toBe(after[i - 1]!.id);
      }
    });
  });
});
