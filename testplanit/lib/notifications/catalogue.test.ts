import { readFileSync } from "node:fs";
import path from "node:path";
import { NotificationType } from "~/zenstack/models";
import { describe, expect, it } from "vitest";
import enUS from "../../messages/en-US.json";
import {
  getConfigurableNotificationGroups,
  getConfigurableNotificationTypes,
  getNotificationCatalogueEntry,
  isLockedNotificationType,
  isNotificationMuted,
  isRetiredNotificationType,
  NOTIFICATION_CATALOGUE,
  NOTIFICATION_GROUPS,
} from "./catalogue";

const enumValues = Object.values(NotificationType) as string[];
const liveEntries = NOTIFICATION_CATALOGUE.filter((e) => !e.retired);
const retiredEntries = NOTIFICATION_CATALOGUE.filter((e) => e.retired);

const profileMessages = (
  enUS as unknown as {
    users: {
      profile: {
        notifications: {
          groups: Record<string, string>;
          types: Record<string, { label?: string; description?: string }>;
        };
      };
    };
  }
).users.profile.notifications;

const bellSource = readFileSync(
  path.join(__dirname, "../../components/NotificationContent.tsx"),
  "utf8"
);

describe("notification catalogue", () => {
  it("has exactly one entry per NotificationType enum value", () => {
    const catalogued = NOTIFICATION_CATALOGUE.map((e) => e.type as string);
    expect(new Set(catalogued).size).toBe(catalogued.length);
    expect([...catalogued].sort()).toEqual([...enumValues].sort());
  });

  it("uses only known groups", () => {
    for (const entry of NOTIFICATION_CATALOGUE) {
      expect(NOTIFICATION_GROUPS).toContain(entry.group);
    }
  });

  it("has an en-US label and description for every non-retired type", () => {
    for (const entry of liveEntries) {
      const strings = profileMessages.types[entry.type];
      expect(strings?.label, `${entry.type} label`).toBeTruthy();
      expect(strings?.description, `${entry.type} description`).toBeTruthy();
    }
  });

  it("has an en-US heading for every group", () => {
    for (const group of NOTIFICATION_GROUPS) {
      expect(profileMessages.groups[group], group).toBeTruthy();
    }
  });

  it("renders every non-retired type in the bell and no retired one", () => {
    for (const entry of liveEntries) {
      expect(bellSource, `bell branch for ${entry.type}`).toContain(
        `"${entry.type}"`
      );
    }
    for (const entry of retiredEntries) {
      expect(bellSource, `stale bell branch for ${entry.type}`).not.toContain(
        `"${entry.type}"`
      );
    }
  });

  it("locks exactly the integration re-auth and admin broadcast types", () => {
    const locked = NOTIFICATION_CATALOGUE.filter((e) => !e.optional).map(
      (e) => e.type
    );
    expect(locked.sort()).toEqual(
      ["INTEGRATION_AUTH_EXPIRED", "SYSTEM_ANNOUNCEMENT"].sort()
    );
    expect(isLockedNotificationType("SYSTEM_ANNOUNCEMENT")).toBe(true);
    expect(isLockedNotificationType("WHATS_NEW")).toBe(false);
    expect(isLockedNotificationType("NOT_A_TYPE")).toBe(true);
  });

  it("retires the two job-complete types that are never created", () => {
    expect(retiredEntries.map((e) => e.type).sort()).toEqual(
      ["COPY_MOVE_COMPLETE", "GENERATE_FROM_URL_COMPLETE"].sort()
    );
    expect(isRetiredNotificationType("COPY_MOVE_COMPLETE")).toBe(true);
    expect(isRetiredNotificationType("WORK_ASSIGNED")).toBe(false);
    expect(getNotificationCatalogueEntry("WORK_ASSIGNED")?.group).toBe(
      "assignments"
    );
  });

  describe("getConfigurableNotificationTypes", () => {
    it("hides admin-only and retired types from a regular user", () => {
      const types = getConfigurableNotificationTypes({ isAdmin: false }).map(
        (e) => e.type
      );
      expect(types).not.toContain("USER_REGISTERED");
      expect(types).not.toContain("LLM_BUDGET_ALERT");
      expect(types).not.toContain("COPY_MOVE_COMPLETE");
      expect(types).not.toContain("GENERATE_FROM_URL_COMPLETE");
      expect(types).toContain("WORK_ASSIGNED");
      expect(types).toContain("WHATS_NEW");
    });

    it("shows admin-only types to an admin but never retired ones", () => {
      const types = getConfigurableNotificationTypes({ isAdmin: true }).map(
        (e) => e.type
      );
      expect(types).toContain("USER_REGISTERED");
      expect(types).toContain("LLM_BUDGET_ALERT");
      expect(types).not.toContain("COPY_MOVE_COMPLETE");
      expect(types.length).toBe(liveEntries.length);
    });

    it("groups entries in catalogue order and drops empty groups", () => {
      const sections = getConfigurableNotificationGroups({ isAdmin: false });
      expect(sections.map((s) => s.group)).not.toContain("administration");
      expect(sections[0].group).toBe("assignments");
      for (const section of sections) {
        expect(section.entries.length).toBeGreaterThan(0);
        for (const entry of section.entries) {
          expect(entry.group).toBe(section.group);
        }
      }
    });
  });

  describe("isNotificationMuted", () => {
    it.each(NOTIFICATION_CATALOGUE.map((e) => [e.type, e.optional] as const))(
      "%s listed in the muted set counts as muted only when optional (%s)",
      (type, optional) => {
        expect(
          isNotificationMuted({ mutedNotificationTypes: [type] }, type)
        ).toBe(optional);
      }
    );

    it("treats a missing preferences row or empty set as nothing muted", () => {
      expect(isNotificationMuted(null, "WORK_ASSIGNED")).toBe(false);
      expect(isNotificationMuted(undefined, "WORK_ASSIGNED")).toBe(false);
      expect(
        isNotificationMuted({ mutedNotificationTypes: [] }, "WORK_ASSIGNED")
      ).toBe(false);
      expect(
        isNotificationMuted({ mutedNotificationTypes: null }, "WORK_ASSIGNED")
      ).toBe(false);
    });

    it("only mutes the listed type, not its neighbours", () => {
      const prefs = { mutedNotificationTypes: ["SESSION_ASSIGNED"] };
      expect(isNotificationMuted(prefs, "WORK_ASSIGNED")).toBe(false);
      expect(isNotificationMuted(prefs, "SESSION_ASSIGNED")).toBe(true);
    });

    it("never mutes an unknown type", () => {
      expect(
        isNotificationMuted(
          { mutedNotificationTypes: ["NOT_A_TYPE"] },
          "NOT_A_TYPE"
        )
      ).toBe(false);
    });
  });
});
