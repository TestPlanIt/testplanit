import { describe, it, expect } from "vitest";
import { sanitizeName, replaceProblematicChars } from "./stringUtils";

describe("stringUtils", () => {
  describe("sanitizeName", () => {
    it("should replace double quotes with underscore", () => {
      expect(sanitizeName('file"name')).toBe("file_name");
    });

    it("should replace single quotes with underscore", () => {
      expect(sanitizeName("file'name")).toBe("file_name");
    });

    it("should replace forward slash with underscore", () => {
      expect(sanitizeName("file/name")).toBe("file_name");
    });

    it("should replace backslash with underscore", () => {
      expect(sanitizeName("file\\name")).toBe("file_name");
    });

    it("should replace colon with underscore", () => {
      expect(sanitizeName("file:name")).toBe("file_name");
    });

    it("should replace asterisk with underscore", () => {
      expect(sanitizeName("file*name")).toBe("file_name");
    });

    it("should replace question mark with underscore", () => {
      expect(sanitizeName("file?name")).toBe("file_name");
    });

    it("should replace less than with underscore", () => {
      expect(sanitizeName("file<name")).toBe("file_name");
    });

    it("should replace greater than with underscore", () => {
      expect(sanitizeName("file>name")).toBe("file_name");
    });

    it("should replace pipe with underscore", () => {
      expect(sanitizeName("file|name")).toBe("file_name");
    });

    it("should replace multiple problematic characters", () => {
      expect(sanitizeName('file"name/path:test')).toBe("file_name_path_test");
    });

    it("should trim whitespace", () => {
      expect(sanitizeName("  filename  ")).toBe("filename");
    });

    it("should handle empty string", () => {
      expect(sanitizeName("")).toBe("");
    });

    it("should not modify safe characters", () => {
      expect(sanitizeName("safe-file_name.txt")).toBe("safe-file_name.txt");
    });

    it("should handle all problematic characters at once", () => {
      expect(sanitizeName('"\'/:*?<>|')).toBe("_________");
    });
  });

  describe("replaceProblematicChars", () => {
    it("should replace problematic characters without trimming", () => {
      expect(replaceProblematicChars('  file"name  ')).toBe("  file_name  ");
    });

    it("should replace double quotes with underscore", () => {
      expect(replaceProblematicChars('file"name')).toBe("file_name");
    });

    it("should replace single quotes with underscore", () => {
      expect(replaceProblematicChars("file'name")).toBe("file_name");
    });

    it("should replace all problematic characters", () => {
      expect(replaceProblematicChars('"\'/:*?<>|')).toBe("_________");
    });

    it("should preserve leading and trailing whitespace", () => {
      expect(replaceProblematicChars("  name  ")).toBe("  name  ");
    });

    it("should handle empty string", () => {
      expect(replaceProblematicChars("")).toBe("");
    });
  });
});
