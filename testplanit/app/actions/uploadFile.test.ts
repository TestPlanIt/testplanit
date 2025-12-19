import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Since uploadFile is a server action that creates S3Client internally,
// we focus on testing the validation logic which doesn't require S3

describe("uploadFile validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      AWS_BUCKET_NAME: "test-bucket",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "test-access-key",
      AWS_SECRET_ACCESS_KEY: "test-secret-key",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // Import dynamically to get fresh module with mocks
  async function getUploadFile() {
    const module = await import("./uploadFile");
    return module.uploadFile;
  }

  describe("input validation", () => {
    it("should return error when no file is provided", async () => {
      const uploadFile = await getUploadFile();
      const formData = new FormData();

      const result = await uploadFile(formData, "avatar");

      expect(result).toEqual({ error: "No file provided" });
    });

    it("should return error for invalid upload type", async () => {
      const uploadFile = await getUploadFile();
      const file = new File(["test content"], "test.jpg", {
        type: "image/jpeg",
      });
      const formData = new FormData();
      formData.append("file", file);

      // @ts-expect-error - testing invalid type
      const result = await uploadFile(formData, "invalid-type");

      expect(result).toEqual({ error: "Invalid upload type: invalid-type" });
    });

    it("should return error when bucket is not configured", async () => {
      delete process.env.AWS_BUCKET_NAME;
      const uploadFile = await getUploadFile();

      const file = new File(["test content"], "test.jpg", {
        type: "image/jpeg",
      });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "avatar");

      expect(result).toEqual({ error: "Storage bucket not configured" });
    });
  });

  describe("file size validation", () => {
    it("should reject avatar files larger than 2MB", async () => {
      const uploadFile = await getUploadFile();
      const largeContent = new ArrayBuffer(3 * 1024 * 1024); // 3MB
      const file = new File([largeContent], "large-avatar.jpg", {
        type: "image/jpeg",
      });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "avatar");

      expect(result.error).toContain("File is too large");
      expect(result.error).toContain("2MB");
    });

    it("should reject project-icon files larger than 4MB", async () => {
      const uploadFile = await getUploadFile();
      const largeContent = new ArrayBuffer(5 * 1024 * 1024); // 5MB
      const file = new File([largeContent], "large-icon.jpg", {
        type: "image/jpeg",
      });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "project-icon");

      expect(result.error).toContain("File is too large");
      expect(result.error).toContain("4MB");
    });

    it("should reject docimage files larger than 10MB", async () => {
      const uploadFile = await getUploadFile();
      const largeContent = new ArrayBuffer(11 * 1024 * 1024); // 11MB
      const file = new File([largeContent], "large-doc.jpg", {
        type: "image/jpeg",
      });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "docimage");

      expect(result.error).toContain("File is too large");
      expect(result.error).toContain("10MB");
    });

    it("should reject attachment files larger than 10MB", async () => {
      const uploadFile = await getUploadFile();
      const largeContent = new ArrayBuffer(11 * 1024 * 1024); // 11MB
      const file = new File([largeContent], "large-attachment.pdf", {
        type: "application/pdf",
      });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "attachment");

      expect(result.error).toContain("File is too large");
      expect(result.error).toContain("10MB");
    });
  });

  describe("upload type configurations", () => {
    // Test that the upload type configs are correct by checking size limits
    it("avatar should have 2MB limit", async () => {
      const uploadFile = await getUploadFile();
      // Test exactly at limit (should pass validation, may fail on S3)
      const atLimit = new ArrayBuffer(2 * 1024 * 1024);
      const file = new File([atLimit], "avatar.jpg", { type: "image/jpeg" });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "avatar");

      // Should not return size error
      expect(result.error).not.toContain("File is too large");
    });

    it("project-icon should have 4MB limit", async () => {
      const uploadFile = await getUploadFile();
      const atLimit = new ArrayBuffer(4 * 1024 * 1024);
      const file = new File([atLimit], "icon.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "project-icon");

      expect(result.error).not.toContain("File is too large");
    });

    it("docimage should have 10MB limit", async () => {
      const uploadFile = await getUploadFile();
      const atLimit = new ArrayBuffer(10 * 1024 * 1024);
      const file = new File([atLimit], "doc.png", { type: "image/png" });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "docimage");

      expect(result.error).not.toContain("File is too large");
    });

    it("attachment should have 10MB limit", async () => {
      const uploadFile = await getUploadFile();
      const atLimit = new ArrayBuffer(10 * 1024 * 1024);
      const file = new File([atLimit], "file.pdf", {
        type: "application/pdf",
      });
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadFile(formData, "attachment");

      expect(result.error).not.toContain("File is too large");
    });
  });
});
