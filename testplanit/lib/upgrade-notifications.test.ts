import { describe, it, expect } from "vitest";
import {
  getUpgradeNotificationsBetweenVersions,
  upgradeNotifications,
} from "./upgrade-notifications";

describe("upgrade-notifications", () => {
  describe("upgradeNotifications", () => {
    it("should have notifications defined", () => {
      expect(Object.keys(upgradeNotifications).length).toBeGreaterThan(0);
    });

    it("should have title and message for each notification", () => {
      for (const [version, notification] of Object.entries(
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
        const result = getUpgradeNotificationsBetweenVersions(
          "0.3.5",
          "0.4.5"
        );
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
});
