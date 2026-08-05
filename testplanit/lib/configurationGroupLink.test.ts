import { describe, expect, it, vi } from "vitest";
import {
  applyConfigurationGroupPeerStamp,
  canEditConfigurationGroup,
  configurationGroupUpdateData,
} from "./configurationGroupLink";

const GROUP_A = "11111111-1111-4111-8111-111111111111";
const GROUP_B = "22222222-2222-4222-8222-222222222222";

describe("configurationGroupUpdateData", () => {
  it("carries the picked group id", () => {
    expect(configurationGroupUpdateData(GROUP_A)).toEqual({
      configurationGroupId: GROUP_A,
    });
  });

  it("normalises an unset value to an explicit null", () => {
    // The RPC guard treats a MISSING key as "don't touch membership", so an
    // unlink has to arrive as an explicit null rather than undefined.
    expect(configurationGroupUpdateData(null)).toEqual({
      configurationGroupId: null,
    });
    expect(configurationGroupUpdateData(undefined)).toEqual({
      configurationGroupId: null,
    });
  });

  it("produces the same slice for both of the run form's save paths", () => {
    // The run edit form writes the run from two branches — the cases-changed
    // path and the metadata-only path. Both spread this builder, so a field
    // can't reach one branch and silently no-op on the other.
    const casesChangedPath = {
      ...configurationGroupUpdateData(GROUP_A),
      testCases: { upsert: [] },
    };
    const metadataOnlyPath = { ...configurationGroupUpdateData(GROUP_A) };

    expect(casesChangedPath.configurationGroupId).toBe(
      metadataOnlyPath.configurationGroupId
    );
    expect(metadataOnlyPath.configurationGroupId).toBe(GROUP_A);
  });
});

describe("canEditConfigurationGroup", () => {
  it("requires edit permission", () => {
    expect(canEditConfigurationGroup({ canAddEdit: false })).toBe(false);
    expect(canEditConfigurationGroup({ canAddEdit: true })).toBe(true);
  });

  it("is unavailable on completed records, which render no Save", () => {
    expect(
      canEditConfigurationGroup({ canAddEdit: true, isCompleted: true })
    ).toBe(false);
  });

  it("is unavailable while several configurations are viewed at once", () => {
    expect(
      canEditConfigurationGroup({
        canAddEdit: true,
        isMultiConfigurationView: true,
      })
    ).toBe(false);
  });
});

describe("applyConfigurationGroupPeerStamp", () => {
  it("stamps the peer a fresh group was minted for", async () => {
    const update = vi.fn().mockResolvedValue({});

    await applyConfigurationGroupPeerStamp({
      update,
      recordId: 1,
      groupId: GROUP_A,
      stampTargetId: 9,
      previousGroupId: null,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { configurationGroupId: GROUP_A },
    });
  });

  it("does nothing when the peer was already in a group", async () => {
    const update = vi.fn().mockResolvedValue({});

    await applyConfigurationGroupPeerStamp({
      update,
      recordId: 1,
      groupId: GROUP_A,
      stampTargetId: null,
      previousGroupId: null,
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing on an unlink", async () => {
    const update = vi.fn().mockResolvedValue({});

    await applyConfigurationGroupPeerStamp({
      update,
      recordId: 1,
      groupId: null,
      stampTargetId: 9,
      previousGroupId: GROUP_A,
    });

    expect(update).not.toHaveBeenCalled();
  });

  it("rolls the record back to its previous group when the peer write fails", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("peer write failed"))
      .mockResolvedValue({});

    await expect(
      applyConfigurationGroupPeerStamp({
        update,
        recordId: 1,
        groupId: GROUP_A,
        stampTargetId: 9,
        previousGroupId: GROUP_B,
      })
    ).rejects.toThrow("peer write failed");

    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 1 },
      data: { configurationGroupId: GROUP_B },
    });
  });

  it("rolls back to unlinked when the record had no group before", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({});

    await expect(
      applyConfigurationGroupPeerStamp({
        update,
        recordId: 1,
        groupId: GROUP_A,
        stampTargetId: 9,
        previousGroupId: null,
      })
    ).rejects.toThrow("boom");

    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 1 },
      data: { configurationGroupId: null },
    });
  });

  it("surfaces the original failure even when the rollback also fails", async () => {
    const update = vi.fn().mockRejectedValue(new Error("peer write failed"));

    await expect(
      applyConfigurationGroupPeerStamp({
        update,
        recordId: 1,
        groupId: GROUP_A,
        stampTargetId: 9,
        previousGroupId: null,
      })
    ).rejects.toThrow("peer write failed");
  });

  it("never writes the record to itself", async () => {
    const update = vi.fn().mockResolvedValue({});

    await applyConfigurationGroupPeerStamp({
      update,
      recordId: 9,
      groupId: GROUP_A,
      stampTargetId: 9,
      previousGroupId: null,
    });

    expect(update).not.toHaveBeenCalled();
  });
});
