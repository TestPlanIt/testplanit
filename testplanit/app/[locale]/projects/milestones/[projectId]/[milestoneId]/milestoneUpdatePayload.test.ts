import { describe, expect, it } from "vitest";
import {
  buildMilestoneUpdatePayload,
  TRACKER_OWNED_MILESTONE_FIELDS,
  type MilestoneUpdateFormValues,
} from "./milestoneUpdatePayload";

const formValues = (
  overrides: Partial<MilestoneUpdateFormValues> = {}
): MilestoneUpdateFormValues => ({
  name: "Sprint 12",
  note: '{"type":"doc","content":[]}',
  docs: '{"type":"doc","content":[]}',
  isStarted: true,
  isCompleted: false,
  startedAt: new Date("2026-01-01T00:00:00Z"),
  completedAt: new Date("2026-02-01T00:00:00Z"),
  automaticCompletion: true,
  enableNotifications: true,
  notifyDaysBefore: 5,
  milestoneTypesId: 3,
  parentId: 7,
  ...overrides,
});

describe("buildMilestoneUpdatePayload", () => {
  describe("local (non-synced) milestone", () => {
    it("keeps the tracker-owned fields in the payload", () => {
      const payload = buildMilestoneUpdatePayload(formValues(), false);
      for (const field of TRACKER_OWNED_MILESTONE_FIELDS) {
        expect(payload).toHaveProperty(field);
      }
      expect(payload).toMatchObject({
        name: "Sprint 12",
        isStarted: true,
        isCompleted: false,
      });
    });

    it("transforms enableNotifications into notifyDaysBefore and never submits it", () => {
      const enabled = buildMilestoneUpdatePayload(formValues(), false);
      expect(enabled).not.toHaveProperty("enableNotifications");
      expect(enabled.notifyDaysBefore).toBe(5);

      const disabled = buildMilestoneUpdatePayload(
        formValues({ enableNotifications: false }),
        false
      );
      expect(disabled.notifyDaysBefore).toBe(0);
    });

    it("forces automaticCompletion/notifyDaysBefore off when there is no completedAt", () => {
      const payload = buildMilestoneUpdatePayload(
        formValues({ completedAt: null }),
        false
      );
      expect(payload.automaticCompletion).toBe(false);
      expect(payload.notifyDaysBefore).toBe(0);
    });

    it("normalizes an unset parentId to null", () => {
      const payload = buildMilestoneUpdatePayload(
        formValues({ parentId: undefined }),
        false
      );
      expect(payload.parentId).toBeNull();
    });
  });

  describe("synced milestone (integrationId != null)", () => {
    it("excludes every tracker-owned field locked by @deny('update', integrationId != null)", () => {
      const payload = buildMilestoneUpdatePayload(formValues(), true);
      for (const field of TRACKER_OWNED_MILESTONE_FIELDS) {
        expect(payload).not.toHaveProperty(field);
      }
    });

    it("still carries the local-owned fields so a synced milestone save succeeds", () => {
      const payload = buildMilestoneUpdatePayload(formValues(), true);
      expect(payload).toMatchObject({
        docs: '{"type":"doc","content":[]}',
        milestoneTypesId: 3,
        parentId: 7,
        automaticCompletion: true,
        notifyDaysBefore: 5,
      });
      expect(payload).not.toHaveProperty("enableNotifications");
    });

    it("submits ONLY local-owned keys (no extras that could trip field-level deny)", () => {
      const payload = buildMilestoneUpdatePayload(formValues(), true);
      expect(Object.keys(payload).sort()).toEqual(
        [
          "automaticCompletion",
          "docs",
          "milestoneTypesId",
          "notifyDaysBefore",
          "parentId",
        ].sort()
      );
    });
  });
});
