import { describe, expect, it } from "vitest";
import {
  classifyStorageObject,
  storageFolderOf,
  storageKeysIn,
} from "./storageScanRules";

describe("storageFolderOf", () => {
  it("is the first two segments of a key", () => {
    expect(storageFolderOf("uploads/attachments/49/shot.png")).toBe(
      "uploads/attachments"
    );
    expect(storageFolderOf("uploads/imports/testmo/a.zip")).toBe(
      "uploads/imports"
    );
    expect(storageFolderOf("uploads/stray.txt")).toBe("uploads");
  });
});

describe("classifyStorageObject", () => {
  it("calls an object in use or an orphan", () => {
    expect(classifyStorageObject(true)).toBe("REFERENCED");
    expect(classifyStorageObject(false)).toBe("ORPHAN");
  });
});

describe("storageKeysIn", () => {
  it("finds a key in each shape a storage URL takes", () => {
    const text = JSON.stringify({
      a: "/api/storage/uploads/document-images/7/a.png",
      b: "https://bucket.s3.us-east-1.amazonaws.com/uploads/documentation-images/7/b.png",
      c: "https://s3.example.com/bucket/uploads/attachments/7/c.png?X-Amz-Signature=abc",
    });
    expect(storageKeysIn(text)).toEqual(
      expect.arrayContaining([
        "uploads/document-images/7/a.png",
        "uploads/documentation-images/7/b.png",
        "uploads/attachments/7/c.png",
      ])
    );
  });

  it("reads a key with spaces whole, written plainly or encoded", () => {
    expect(
      storageKeysIn(
        '{"src":"https://h/uploads/document-images/7/My Shot 1.png_17"}'
      )
    ).toContain("uploads/document-images/7/My Shot 1.png_17");
    expect(
      storageKeysIn(
        '{"src":"https://h/uploads/document-images/7/My%20Shot.png"}'
      )
    ).toEqual(
      expect.arrayContaining([
        "uploads/document-images/7/My%20Shot.png",
        "uploads/document-images/7/My Shot.png",
      ])
    );
  });

  it("stops at the end of a URL that more text follows", () => {
    expect(
      storageKeysIn(
        "see ![shot](/api/storage/uploads/document-images/7/a.png) for more"
      )
    ).toContain("uploads/document-images/7/a.png");
  });

  it("finds nothing where no storage path is named", () => {
    expect(storageKeysIn("no files here, just upload instructions")).toEqual(
      []
    );
  });
});
