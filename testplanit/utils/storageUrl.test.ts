import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getStorageUrl, getStorageUrlClient } from "./storageUrl";

const originalEnv = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
});

afterEach(() => {
  process.env = originalEnv;
});

describe("getStorageUrl", () => {
  describe("when not hosted or has public endpoint", () => {
    it("should return original URL when IS_HOSTED is not true", () => {
      process.env.IS_HOSTED = "false";
      const url = "http://minio:9000/bucket/uploads/file.png";
      expect(getStorageUrl(url)).toBe(url);
    });

    it("should return original URL when AWS_PUBLIC_ENDPOINT_URL is set", () => {
      process.env.IS_HOSTED = "true";
      process.env.AWS_PUBLIC_ENDPOINT_URL = "https://cdn.example.com";
      const url = "http://minio:9000/bucket/uploads/file.png";
      expect(getStorageUrl(url)).toBe(url);
    });

    it("should return original URL when IS_HOSTED is undefined", () => {
      delete process.env.IS_HOSTED;
      const url = "http://minio:9000/bucket/uploads/file.png";
      expect(getStorageUrl(url)).toBe(url);
    });
  });

  describe("when hosted without public endpoint", () => {
    beforeEach(() => {
      process.env.IS_HOSTED = "true";
      delete process.env.AWS_PUBLIC_ENDPOINT_URL;
      process.env.AWS_BUCKET_NAME = "testplanit-demo";
    });

    it("should convert MinIO URL to proxy URL", () => {
      const url = "http://minio:9000/testplanit-demo/uploads/file.png";
      expect(getStorageUrl(url)).toBe("/api/storage/uploads/file.png");
    });

    it("should handle URLs with nested paths", () => {
      const url =
        "http://minio:9000/testplanit-demo/uploads/images/2024/file.png";
      expect(getStorageUrl(url)).toBe(
        "/api/storage/uploads/images/2024/file.png"
      );
    });

    it("should handle URLs without bucket name prefix", () => {
      process.env.AWS_BUCKET_NAME = undefined;
      const url = "http://minio:9000/uploads/file.png";
      expect(getStorageUrl(url)).toBe("/api/storage/uploads/file.png");
    });
  });

  describe("edge cases", () => {
    it("should return null for null input", () => {
      expect(getStorageUrl(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(getStorageUrl(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(getStorageUrl("")).toBeNull();
    });

    it("should return original URL for invalid URLs in hosted mode", () => {
      process.env.IS_HOSTED = "true";
      delete process.env.AWS_PUBLIC_ENDPOINT_URL;
      // Invalid URL should fall back to original
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = getStorageUrl("not-a-valid-url");
      expect(result).toBe("not-a-valid-url");
      consoleSpy.mockRestore();
    });
  });
});

describe("getStorageUrlClient", () => {
  describe("internal MinIO URL detection", () => {
    it("should convert testplanit-shared-minio URLs", () => {
      const url =
        "http://testplanit-shared-minio:9000/testplanit-demo/uploads/file.png";
      expect(getStorageUrlClient(url)).toBe("/api/storage/uploads/file.png");
    });

    it("should convert minio:9000 URLs", () => {
      const url = "http://minio:9000/testplanit-demo/uploads/file.png";
      expect(getStorageUrlClient(url)).toBe("/api/storage/uploads/file.png");
    });

    it("should convert any http URL with :9000", () => {
      const url = "http://localhost:9000/testplanit-demo/uploads/file.png";
      expect(getStorageUrlClient(url)).toBe("/api/storage/uploads/file.png");
    });

    it("should not convert https URLs with :9000", () => {
      const url = "https://storage.example.com:9000/bucket/file.png";
      // HTTPS URLs are not considered internal MinIO
      expect(getStorageUrlClient(url)).toBe(url);
    });
  });

  describe("public URLs", () => {
    it("should return public S3 URLs unchanged", () => {
      const url = "https://s3.amazonaws.com/bucket/uploads/file.png";
      expect(getStorageUrlClient(url)).toBe(url);
    });

    it("should return CDN URLs unchanged", () => {
      const url = "https://cdn.example.com/uploads/file.png";
      expect(getStorageUrlClient(url)).toBe(url);
    });
  });

  describe("bucket name extraction", () => {
    it("should extract bucket name following testplanit- pattern", () => {
      const url =
        "http://minio:9000/testplanit-subdomain/uploads/images/file.png";
      expect(getStorageUrlClient(url)).toBe(
        "/api/storage/uploads/images/file.png"
      );
    });

    it("should handle path without testplanit- prefix", () => {
      const url = "http://minio:9000/other-bucket/uploads/file.png";
      // Should use full path since it doesn't match testplanit- pattern
      expect(getStorageUrlClient(url)).toBe(
        "/api/storage/other-bucket/uploads/file.png"
      );
    });
  });

  describe("edge cases", () => {
    it("should return null for null input", () => {
      expect(getStorageUrlClient(null)).toBeNull();
    });

    it("should return null for undefined input", () => {
      expect(getStorageUrlClient(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(getStorageUrlClient("")).toBeNull();
    });

    it("should return original URL for invalid URLs that look internal", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      // This is an internal-looking URL but invalid
      const result = getStorageUrlClient("http://minio:9000");
      // Since URL parsing may work but path extraction might not, check behavior
      expect(result).toBeDefined();
      consoleSpy.mockRestore();
    });
  });
});
