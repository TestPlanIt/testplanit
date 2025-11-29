import { describe, it, expect, vi, beforeEach } from "vitest";
import { getServerTranslation, formatLocaleForUrl } from "./server-translations";

// Mock fs/promises with a factory function
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

// Import the mocked module
import fs from 'fs/promises';

describe("server-translations", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock the en-US translations
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (path.toString().includes('en-US.json')) {
        return JSON.stringify({
          components: {
            notifications: {
              content: {
                testCaseAssignmentTitle: "New Test Case Assignment",
                assignedTestCase: "assigned you to test case",
                assignedMultipleTestCases: "assigned you {count} test cases",
                inProject: "in project",
                casesInProject: "{count, plural, =1 {# case} other {# cases}} in"
              }
            }
          }
        });
      }
      if (path.toString().includes('fr-FR.json')) {
        throw new Error('File not found');
      }
      // Return en-US for any other locale (fallback test)
      return JSON.stringify({
        components: {
          notifications: {
            content: {
              testCaseAssignmentTitle: "New Test Case Assignment"
            }
          }
        }
      });
    });
  });

  describe("getServerTranslation", () => {
    it("should get a simple translation", async () => {
      const result = await getServerTranslation(
        "en-US",
        "components.notifications.content.testCaseAssignmentTitle"
      );
      expect(result).toBe("New Test Case Assignment");
    });

    it("should handle placeholders", async () => {
      const result = await getServerTranslation(
        "en-US",
        "components.notifications.content.assignedMultipleTestCases",
        { count: 5 }
      );
      expect(result).toBe("assigned you 5 test cases");
    });

    it("should handle complex pluralization", async () => {
      const result1 = await getServerTranslation(
        "en-US",
        "components.notifications.content.casesInProject",
        { count: 1 }
      );
      expect(result1).toBe("1 case in");

      const result2 = await getServerTranslation(
        "en-US",
        "components.notifications.content.casesInProject",
        { count: 5 }
      );
      expect(result2).toBe("5 cases in");
    });

    it("should return key if translation not found", async () => {
      const result = await getServerTranslation(
        "en-US",
        "non.existent.key"
      );
      expect(result).toBe("non.existent.key");
    });

    it("should fall back to en-US for missing locale", async () => {
      const result = await getServerTranslation(
        "fr-FR",
        "components.notifications.content.testCaseAssignmentTitle"
      );
      expect(result).toBe("New Test Case Assignment");
    });
  });

  describe("formatLocaleForUrl", () => {
    it("should convert underscore to dash", () => {
      expect(formatLocaleForUrl("en_US")).toBe("en-US");
      expect(formatLocaleForUrl("es_ES")).toBe("es-ES");
    });
    
    it("should normalize locale in loadTranslations", async () => {
      // This test verifies that es_ES is normalized to es-ES when loading
      const result = await getServerTranslation(
        "en_US", // Using underscore format
        "components.notifications.content.testCaseAssignmentTitle"
      );
      expect(result).toBe("New Test Case Assignment");
    });

    it("should handle already formatted locales", () => {
      expect(formatLocaleForUrl("en-US")).toBe("en-US");
    });
  });
});