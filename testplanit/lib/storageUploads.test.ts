import { describe, expect, it } from "vitest";
import {
  buildUploadKey,
  sanitizeFileName,
  sanitizeKeyPrefix,
  validateUpload,
} from "./storageUploads";

describe("sanitizeKeyPrefix", () => {
  it("keeps only letters, digits, underscore and hyphen", () => {
    expect(sanitizeKeyPrefix("../../a b/c-d_e")).toBe("abc-d_e");
  });

  it("treats null and undefined as empty", () => {
    expect(sanitizeKeyPrefix(null)).toBe("");
    expect(sanitizeKeyPrefix(undefined)).toBe("");
  });

  it("caps the prefix at 64 characters", () => {
    expect(sanitizeKeyPrefix("a".repeat(100))).toHaveLength(64);
  });
});

describe("sanitizeFileName", () => {
  it("drops directory segments from either separator", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\me\\shot.png")).toBe("shot.png");
  });

  it("replaces unsafe characters and leading dots", () => {
    expect(sanitizeFileName("..my file?.png")).toBe("my_file_.png");
  });

  it("keeps the extension when truncating a long name", () => {
    const name = sanitizeFileName(`${"a".repeat(300)}.png`);
    expect(name).toHaveLength(128);
    expect(name.endsWith(".png")).toBe(true);
  });

  it("falls back to 'file' when nothing usable remains", () => {
    expect(sanitizeFileName("../")).toBe("file");
    expect(sanitizeFileName("")).toBe("file");
  });
});

describe("buildUploadKey", () => {
  it("places the key in the type's folder", () => {
    expect(buildUploadKey("avatar", "u1", "me.png")).toMatch(
      /^uploads\/avatars\/u1_\d+_me\.png$/
    );
  });

  it("omits the separator without a prefix and the name without a file", () => {
    expect(buildUploadKey("attachment")).toMatch(/^uploads\/attachments\/\d+$/);
  });
});

describe("validateUpload", () => {
  it("rejects non-images for image-only types", () => {
    const file = new File(["x"], "x.html", { type: "text/html" });
    expect(validateUpload(file, "project-icon")).toBe(
      "Only image files are allowed."
    );
  });

  it("accepts any type for attachments", () => {
    const file = new File(["x"], "x.zip", { type: "application/zip" });
    expect(validateUpload(file, "attachment")).toBeNull();
  });

  it("rejects files over the type's limit", () => {
    const file = new File([new ArrayBuffer(3 * 1024 * 1024)], "a.png", {
      type: "image/png",
    });
    expect(validateUpload(file, "avatar")).toContain("2MB");
  });
});
