import { Access } from "~/zenstack/models";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  getUpgradeNotificationsBetweenVersions,
  notificationTargetsAccess,
  upgradeNotifications,
} from "./upgrade-notifications";

describe("upgrade-notifications", () => {
  describe("upgradeNotifications", () => {
    it("should have notifications defined", () => {
      expect(Object.keys(upgradeNotifications).length).toBeGreaterThan(0);
    });

    it("should have title and message for each notification", () => {
      for (const [_version, notification] of Object.entries(
        upgradeNotifications
      )) {
        expect(notification.title).toBeDefined();
        expect(notification.title.length).toBeGreaterThan(0);
        expect(notification.message).toBeDefined();
        expect(notification.message.length).toBeGreaterThan(0);
      }
    });

    it("should have valid version format keys", () => {
      const versionPattern = /^\d+\.\d+\.\d+$/;
      for (const version of Object.keys(upgradeNotifications)) {
        expect(version).toMatch(versionPattern);
      }
    });
  });

  describe("getUpgradeNotificationsBetweenVersions", () => {
    describe("with null lastSeenVersion", () => {
      it("should return all notifications up to current version", () => {
        const result = getUpgradeNotificationsBetweenVersions(null, "99.99.99");
        expect(result.length).toBe(Object.keys(upgradeNotifications).length);
      });

      it("should return notifications in version order", () => {
        const result = getUpgradeNotificationsBetweenVersions(null, "99.99.99");
        for (let i = 1; i < result.length; i++) {
          const prevParts = result[i - 1].version.split(".").map(Number);
          const currParts = result[i].version.split(".").map(Number);
          const prevIsLess =
            prevParts[0] < currParts[0] ||
            (prevParts[0] === currParts[0] && prevParts[1] < currParts[1]) ||
            (prevParts[0] === currParts[0] &&
              prevParts[1] === currParts[1] &&
              prevParts[2] < currParts[2]);
          expect(prevIsLess).toBe(true);
        }
      });

      it("should not return versions greater than current version", () => {
        const result = getUpgradeNotificationsBetweenVersions(null, "0.3.0");
        for (const item of result) {
          const itemParts = item.version.split(".").map(Number);
          expect(
            itemParts[0] < 0 ||
              (itemParts[0] === 0 && itemParts[1] < 3) ||
              (itemParts[0] === 0 && itemParts[1] === 3 && itemParts[2] <= 0)
          ).toBe(true);
        }
      });
    });

    describe("with lastSeenVersion", () => {
      it("should only return versions after lastSeenVersion", () => {
        const result = getUpgradeNotificationsBetweenVersions(
          "0.3.0",
          "99.99.99"
        );
        for (const item of result) {
          const itemParts = item.version.split(".").map(Number);
          const isAfter =
            itemParts[0] > 0 ||
            (itemParts[0] === 0 && itemParts[1] > 3) ||
            (itemParts[0] === 0 && itemParts[1] === 3 && itemParts[2] > 0);
          expect(isAfter).toBe(true);
        }
      });

      it("should not include the lastSeenVersion itself", () => {
        const result = getUpgradeNotificationsBetweenVersions(
          "0.5.0",
          "99.99.99"
        );
        const versions = result.map((r) => r.version);
        expect(versions).not.toContain("0.5.0");
      });

      it("should return empty array when lastSeenVersion equals currentVersion", () => {
        const result = getUpgradeNotificationsBetweenVersions("0.5.0", "0.5.0");
        expect(result).toEqual([]);
      });

      it("should return empty array when lastSeenVersion is greater than currentVersion", () => {
        const result = getUpgradeNotificationsBetweenVersions("0.8.0", "0.5.0");
        expect(result).toEqual([]);
      });
    });

    describe("version range filtering", () => {
      it("should return notifications between two specific versions", () => {
        const result = getUpgradeNotificationsBetweenVersions("0.5.0", "0.7.0");
        const versions = result.map((r) => r.version);
        expect(versions).not.toContain("0.5.0");
        expect(versions).not.toContain("0.3.0");
        expect(versions).not.toContain("0.8.0");
        // Should include 0.6.0 and 0.7.0
        expect(versions).toContain("0.6.0");
        expect(versions).toContain("0.7.0");
      });

      it("should return empty array for non-existent version range", () => {
        const result = getUpgradeNotificationsBetweenVersions("0.3.5", "0.4.5");
        expect(result).toEqual([]);
      });
    });

    describe("notification content", () => {
      it("should return notification objects with version and notification", () => {
        const result = getUpgradeNotificationsBetweenVersions(null, "0.3.0");
        expect(result.length).toBeGreaterThan(0);
        for (const item of result) {
          expect(item).toHaveProperty("version");
          expect(item).toHaveProperty("notification");
          expect(item.notification).toHaveProperty("title");
          expect(item.notification).toHaveProperty("message");
        }
      });
    });

    describe("edge cases", () => {
      it("should handle version with different segment lengths", () => {
        // Testing that versions like "0.3.0" and "0.10.0" are compared correctly
        const result = getUpgradeNotificationsBetweenVersions(
          "0.3.0",
          "0.10.0"
        );
        // Should include versions between 0.3.0 and 0.10.0
        const versions = result.map((r) => r.version);
        expect(versions).toContain("0.5.0");
        expect(versions).toContain("0.6.0");
        expect(versions).toContain("0.7.0");
        expect(versions).toContain("0.8.0");
      });

      it("should handle single version in range", () => {
        const result = getUpgradeNotificationsBetweenVersions("0.4.0", "0.5.5");
        const versions = result.map((r) => r.version);
        expect(versions).toContain("0.5.0");
        expect(versions.length).toBe(1);
      });
    });
  });

  describe("compareVersions (SemVer precedence, incl. pre-release)", () => {
    it("orders numeric release cores", () => {
      expect(compareVersions("0.3.0", "0.10.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "0.40.9")).toBeGreaterThan(0);
      expect(compareVersions("0.40.6", "0.40.6")).toBe(0);
    });

    it("ranks a pre-release below the matching release", () => {
      expect(compareVersions("1.0.0-beta.5", "1.0.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "1.0.0-beta.5")).toBeGreaterThan(0);
    });

    it("orders sibling betas by numeric identifier, not lexically", () => {
      expect(compareVersions("1.0.0-beta.4", "1.0.0-beta.5")).toBeLessThan(0);
      // 10 > 2 numerically, even though "10" < "2" as strings
      expect(compareVersions("1.0.0-beta.2", "1.0.0-beta.10")).toBeLessThan(0);
    });

    it("ranks a shorter pre-release prefix below a longer one", () => {
      expect(compareVersions("1.0.0-beta", "1.0.0-beta.1")).toBeLessThan(0);
    });

    it("ranks a beta above every prior release core", () => {
      expect(compareVersions("1.0.0-beta.5", "0.40.9")).toBeGreaterThan(0);
    });

    it("never returns NaN when a pre-release string is involved", () => {
      for (const other of ["0.40.6", "1.0.0", "1.0.0-beta.4", "1.0.0-beta.5"]) {
        expect(Number.isNaN(compareVersions("1.0.0-beta.5", other))).toBe(
          false
        );
        expect(Number.isNaN(compareVersions(other, "1.0.0-beta.5"))).toBe(
          false
        );
      }
    });
  });

  describe("upgrade window with a beta currentVersion", () => {
    it("returns only notifications newer than lastSeen, never the whole history", () => {
      // Upgrading from a version ahead of the entire notification list to a beta
      // must yield nothing (everything was already seen), not the full backlog.
      const result = getUpgradeNotificationsBetweenVersions(
        "0.49.0",
        "1.0.0-beta.5"
      );
      expect(result).toEqual([]);
    });

    it("still surfaces genuinely-newer 0.x notifications under a 1.0 beta ceiling", () => {
      // A user far behind sees every 0.x notification; the 1.0.0-beta.5 ceiling
      // sits above all of them, so none are wrongly excluded by the beta suffix.
      const result = getUpgradeNotificationsBetweenVersions(
        "0.2.0",
        "1.0.0-beta.5"
      );
      expect(result.length).toBe(Object.keys(upgradeNotifications).length);
    });
  });

  describe("notificationTargetsAccess", () => {
    it("targets every access level when access is omitted", () => {
      const notification = { title: "t", message: "m" };
      for (const access of Object.values(Access)) {
        expect(notificationTargetsAccess(notification, access)).toBe(true);
      }
    });

    it("targets only the listed access levels", () => {
      const notification = {
        title: "t",
        message: "m",
        access: [Access.PROJECTADMIN, Access.ADMIN],
      };
      expect(notificationTargetsAccess(notification, Access.ADMIN)).toBe(true);
      expect(notificationTargetsAccess(notification, Access.PROJECTADMIN)).toBe(
        true
      );
      expect(notificationTargetsAccess(notification, Access.USER)).toBe(false);
      expect(notificationTargetsAccess(notification, Access.NONE)).toBe(false);
    });

    it("targets no access level when access is an empty array", () => {
      const notification = { title: "t", message: "m", access: [] };
      for (const access of Object.values(Access)) {
        expect(notificationTargetsAccess(notification, access)).toBe(false);
      }
    });
  });

  describe("getUpgradeNotificationsBetweenVersions access filtering", () => {
    it("delivers each access-restricted notification only to the levels it targets", () => {
      const restricted = Object.entries(upgradeNotifications).filter(
        ([, notification]) => notification.access
      );
      // The shipped config restricts at least one notification (e.g. SCIM is
      // ADMIN-only); this also guards against the feature being dropped.
      expect(restricted.length).toBeGreaterThan(0);

      for (const [version, notification] of restricted) {
        for (const access of Object.values(Access)) {
          const versions = getUpgradeNotificationsBetweenVersions(
            null,
            "99.99.99",
            access
          ).map((n) => n.version);
          if (notification.access!.includes(access)) {
            expect(versions).toContain(version);
          } else {
            expect(versions).not.toContain(version);
          }
        }
      }
    });

    it("never returns a notification that does not target the requested access level", () => {
      for (const access of Object.values(Access)) {
        const filtered = getUpgradeNotificationsBetweenVersions(
          null,
          "99.99.99",
          access
        );
        for (const { notification } of filtered) {
          expect(notificationTargetsAccess(notification, access)).toBe(true);
        }
      }
    });

    it("returns all notifications when access is omitted (backward compatible)", () => {
      const result = getUpgradeNotificationsBetweenVersions(null, "99.99.99");
      expect(result.length).toBe(Object.keys(upgradeNotifications).length);
    });
  });

  describe("notification messages as plain text", () => {
    const stripHtml = (html: string) => {
      let result = html;
      let prev;
      do {
        prev = result;
        result = result.replace(/<[^>]*>/g, "");
      } while (result !== prev);
      return result.replace(/\s+/g, " ").trim();
    };

    it("should produce non-empty plain text when HTML is stripped from messages", () => {
      for (const [_version, notification] of Object.entries(
        upgradeNotifications
      )) {
        const plainText = stripHtml(notification.message);
        expect(plainText.length).toBeGreaterThan(0);
        // Should not contain any HTML tags
        expect(plainText).not.toMatch(/<[^>]*>/);
      }
    });

    it("should not contain raw HTML entities after stripping", () => {
      for (const [_version, notification] of Object.entries(
        upgradeNotifications
      )) {
        const plainText = stripHtml(notification.message);
        expect(plainText).not.toContain("<strong>");
        expect(plainText).not.toContain("<p>");
        expect(plainText).not.toContain("<ul>");
        expect(plainText).not.toContain("<li>");
      }
    });

    it("should preserve meaningful content after stripping HTML", () => {
      // Test with a known notification that has HTML
      const notification = upgradeNotifications["0.5.0"]; // Audit Logs has HTML
      if (notification) {
        const plainText = stripHtml(notification.message);
        expect(plainText).toContain("audit");
      }
    });
  });
});
