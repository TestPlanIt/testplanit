import { describe, expect, it } from "vitest";
import { clearAutomationImportCaches } from "./automationImports";

describe("automationImports", () => {
  describe("clearAutomationImportCaches", () => {
    it("should be a function", () => {
      expect(typeof clearAutomationImportCaches).toBe("function");
    });

    it("should not throw when called", () => {
      expect(() => clearAutomationImportCaches()).not.toThrow();
    });

    it("should be idempotent (can be called multiple times)", () => {
      expect(() => {
        clearAutomationImportCaches();
        clearAutomationImportCaches();
        clearAutomationImportCaches();
      }).not.toThrow();
    });
  });
});
