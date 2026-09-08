/**
 * Duplicate-flow configuration-group option.
 *
 * The default must stay bug-for-bug identical to the behaviour that shipped
 * before the option existed (a fresh group only when 2+ configurations are
 * picked, source excluded). Opting in joins the source's group instead, and
 * mints + stamps when the source has no group yet.
 */

import { describe, expect, it } from "vitest";
import { planDuplicationGroup } from "./duplicationGroup";

const SOURCE_GROUP = "11111111-2222-4333-8444-555555555555";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("planDuplicationGroup", () => {
  describe("default (copies form their own group)", () => {
    it("leaves a single-configuration duplicate ungrouped", () => {
      expect(
        planDuplicationGroup({
          configCount: 1,
          joinSourceGroup: false,
          sourceGroupId: null,
        })
      ).toEqual({ configurationGroupId: null, stampSource: false });
    });

    it("mints a fresh group for a multi-configuration duplicate", () => {
      const plan = planDuplicationGroup({
        configCount: 3,
        joinSourceGroup: false,
        sourceGroupId: null,
      });

      expect(plan.configurationGroupId).toMatch(UUID_RE);
      expect(plan.stampSource).toBe(false);
    });

    it("ignores the source's group, leaving the source out of it", () => {
      const plan = planDuplicationGroup({
        configCount: 2,
        joinSourceGroup: false,
        sourceGroupId: SOURCE_GROUP,
        mintId: () => "minted-id",
      });

      expect(plan.configurationGroupId).toBe("minted-id");
      expect(plan.stampSource).toBe(false);
    });

    it("never stamps the source", () => {
      for (const configCount of [1, 2, 5]) {
        expect(
          planDuplicationGroup({
            configCount,
            joinSourceGroup: false,
            sourceGroupId: SOURCE_GROUP,
          }).stampSource
        ).toBe(false);
      }
    });
  });

  describe("joining the source's group", () => {
    it("puts the copies in the source's existing group", () => {
      expect(
        planDuplicationGroup({
          configCount: 3,
          joinSourceGroup: true,
          sourceGroupId: SOURCE_GROUP,
          mintId: () => "should-not-be-used",
        })
      ).toEqual({
        configurationGroupId: SOURCE_GROUP,
        stampSource: false,
      });
    });

    it("mints a group and stamps the source when the source has none", () => {
      expect(
        planDuplicationGroup({
          configCount: 2,
          joinSourceGroup: true,
          sourceGroupId: null,
          mintId: () => "minted-id",
        })
      ).toEqual({ configurationGroupId: "minted-id", stampSource: true });
    });

    it("mints a real uuid when no id generator is injected", () => {
      const plan = planDuplicationGroup({
        configCount: 1,
        joinSourceGroup: true,
        sourceGroupId: undefined,
      });

      expect(plan.configurationGroupId).toMatch(UUID_RE);
      expect(plan.stampSource).toBe(true);
    });

    it("joins a single-configuration duplicate to the existing group", () => {
      expect(
        planDuplicationGroup({
          configCount: 1,
          joinSourceGroup: true,
          sourceGroupId: SOURCE_GROUP,
        })
      ).toEqual({
        configurationGroupId: SOURCE_GROUP,
        stampSource: false,
      });
    });

    it("groups a single copy with an ungrouped source (both stamped)", () => {
      const plan = planDuplicationGroup({
        configCount: 1,
        joinSourceGroup: true,
        sourceGroupId: null,
        mintId: () => "minted-id",
      });

      // The pair source + one copy is a real group of two, so the "2+ configs"
      // rule of the default mode deliberately does not apply here.
      expect(plan).toEqual({
        configurationGroupId: "minted-id",
        stampSource: true,
      });
    });

    it("mints a distinct id per duplication", () => {
      const first = planDuplicationGroup({
        configCount: 2,
        joinSourceGroup: true,
        sourceGroupId: null,
      });
      const second = planDuplicationGroup({
        configCount: 2,
        joinSourceGroup: true,
        sourceGroupId: null,
      });

      expect(first.configurationGroupId).not.toBe(second.configurationGroupId);
    });
  });
});
