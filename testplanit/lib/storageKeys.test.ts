import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageKeyForSrc } from "./storageKeys";

describe("storageKeyForSrc", () => {
  beforeEach(() => {
    vi.stubEnv("AWS_BUCKET_NAME", "tpi-bucket");
    vi.stubEnv("AWS_ENDPOINT_URL", "http://rustfs:9000");
    vi.stubEnv("AWS_PUBLIC_ENDPOINT_URL", "https://files.example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the key from a relative proxy URL", () => {
    expect(storageKeyForSrc("/api/storage/uploads/attachments/a.png")).toBe(
      "uploads/attachments/a.png"
    );
  });

  it("reads the key from a proxy URL under a base path or an origin", () => {
    expect(
      storageKeyForSrc("/testplanit/api/storage/uploads/attachments/a.png")
    ).toBe("uploads/attachments/a.png");
    expect(
      storageKeyForSrc(
        "https://app.example.com/api/storage/uploads/attachments/a%20b.png?v=1"
      )
    ).toBe("uploads/attachments/a b.png");
  });

  it("drops the bucket from a path-style URL on either endpoint", () => {
    expect(
      storageKeyForSrc(
        "https://files.example.com/tpi-bucket/uploads/attachments/a.png"
      )
    ).toBe("uploads/attachments/a.png");
    expect(
      storageKeyForSrc("http://rustfs:9000/tpi-bucket/uploads/a.png?X-Amz=1")
    ).toBe("uploads/a.png");
  });

  it("reads the key from a virtual-hosted AWS URL", () => {
    expect(
      storageKeyForSrc(
        "https://tpi-bucket.s3.us-east-1.amazonaws.com/uploads/attachments/a.png"
      )
    ).toBe("uploads/attachments/a.png");
  });

  it("returns null for URLs outside this instance's storage", () => {
    expect(storageKeyForSrc("https://example.com/some/file.png")).toBeNull();
    expect(
      storageKeyForSrc("https://other.s3.us-east-1.amazonaws.com/a.png")
    ).toBeNull();
    expect(storageKeyForSrc("/api/storage/")).toBeNull();
  });
});
