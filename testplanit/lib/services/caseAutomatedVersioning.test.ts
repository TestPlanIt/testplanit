import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/services/testCaseVersionService", () => ({
  createTestCaseVersionInTransaction: vi.fn(() => Promise.resolve({ id: 900 })),
}));

import { createTestCaseVersionInTransaction } from "~/lib/services/testCaseVersionService";
import {
  setCaseAutomated,
  snapshotAutomatedFlip,
} from "./caseAutomatedVersioning";

function fakeTx(current: { automated: boolean } | null) {
  return {
    repositoryCases: {
      findUnique: vi.fn(() => Promise.resolve(current)),
      update: vi.fn(() => Promise.resolve({})),
    },
  };
}

describe("caseAutomatedVersioning", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("snapshotAutomatedFlip", () => {
    it("bumps currentVersion before snapshotting with copied field values", async () => {
      const tx = fakeTx({ automated: true });
      await snapshotAutomatedFlip(tx, 42);

      expect(tx.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { currentVersion: { increment: 1 } },
      });
      expect(createTestCaseVersionInTransaction).toHaveBeenCalledWith(tx, 42, {
        copyFieldValues: true,
      });
      const bumpOrder = tx.repositoryCases.update.mock.invocationCallOrder[0];
      const snapshotOrder = (createTestCaseVersionInTransaction as any).mock
        .invocationCallOrder[0];
      expect(bumpOrder).toBeLessThan(snapshotOrder);
    });
  });

  describe("setCaseAutomated", () => {
    it("writes the flag, bumps the version and snapshots on a manual→automated flip", async () => {
      const tx = fakeTx({ automated: false });
      const flipped = await setCaseAutomated(tx, 7, true, { isDeleted: false });

      expect(flipped).toBe(true);
      expect(tx.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          isDeleted: false,
          automated: true,
          currentVersion: { increment: 1 },
        },
      });
      expect(createTestCaseVersionInTransaction).toHaveBeenCalledWith(tx, 7, {
        copyFieldValues: true,
      });
    });

    it("snapshots a revert (automated→manual) too", async () => {
      const tx = fakeTx({ automated: true });
      expect(await setCaseAutomated(tx, 7, false)).toBe(true);
      expect(createTestCaseVersionInTransaction).toHaveBeenCalledTimes(1);
    });

    it("writes the flag without a version when the value is unchanged", async () => {
      const tx = fakeTx({ automated: true });
      const flipped = await setCaseAutomated(tx, 7, true, {
        isArchived: false,
      });

      expect(flipped).toBe(false);
      expect(tx.repositoryCases.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { isArchived: false, automated: true },
      });
      expect(createTestCaseVersionInTransaction).not.toHaveBeenCalled();
    });

    it("throws when the case does not exist", async () => {
      const tx = fakeTx(null);
      await expect(setCaseAutomated(tx, 99, true)).rejects.toThrow(
        "Test case 99 not found"
      );
      expect(tx.repositoryCases.update).not.toHaveBeenCalled();
    });
  });
});
