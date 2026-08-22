import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Since uploadFile is a server action that creates S3Client internally,
// we focus on testing the validation logic which doesn't require S3

describe("uploadFile validation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // UPLOAD_CONFIGS is built at module load, so each test needs a fresh import
    // to see its own env. Without the reset the first import in the file would
    // pin the limits for every test after it.
    vi.resetModules();
    process.env = {
      ...originalEnv,
      AWS_BUCKET_NAME: "test-bucket",
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "test-access-key",
      AWS_SECRET_ACCESS_KEY: "test-secret-key",
    };
    // Exercise the shipped default unless a test opts into an override.
    delete process.env.UPLOAD_MAX_MB;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // Import dynamically to get fresh module with mocks
  async function getUploadFile() {
    const uploadFileModule = await import("./uploadFile");
    return uploadFileModule.uploadFile;
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

  // Operators raise the per-file ceiling with UPLOAD_MAX_MB (see
  // nginx-local/README.md); next.config.ts sizes the server-action body limit
  // from the same variable. Sizes here stay small on purpose — the point is the
  // ceiling that gets applied, and multi-hundred-MB ArrayBuffers make the suite
  // needlessly heavy.
  describe("UPLOAD_MAX_MB override", () => {
    async function getUploadFileWith(maxMb?: string) {
      if (maxMb === undefined) {
        delete process.env.UPLOAD_MAX_MB;
      } else {
        process.env.UPLOAD_MAX_MB = maxMb;
      }
      vi.resetModules();
      const uploadFileModule = await import("./uploadFile");
      return uploadFileModule.uploadFile;
    }

    async function upload(
      uploadFile: Awaited<ReturnType<typeof getUploadFileWith>>,
      type: "attachment" | "docimage" | "avatar",
      bytes: number
    ) {
      const file = new File([new ArrayBuffer(bytes)], "f.pdf", {
        type: "application/pdf",
      });
      const formData = new FormData();
      formData.append("file", file);
      return uploadFile(formData, type);
    }

    it("defaults to 10MB when the variable is unset", async () => {
      const uploadFile = await getUploadFileWith();

      const result = await upload(uploadFile, "attachment", 11 * 1024 * 1024);

      expect(result.error).toContain("File is too large");
      expect(result.error).toContain("10MB");
    });

    it("raises the attachment and docimage ceilings together", async () => {
      const uploadFile = await getUploadFileWith("25");

      const under = await upload(uploadFile, "attachment", 11 * 1024 * 1024);
      expect(under.error).not.toContain("File is too large");

      const overAttachment = await upload(
        uploadFile,
        "attachment",
        26 * 1024 * 1024
      );
      expect(overAttachment.error).toContain("25MB");

      const overDocimage = await upload(
        uploadFile,
        "docimage",
        26 * 1024 * 1024
      );
      expect(overDocimage.error).toContain("25MB");
    });

    it("falls back to the default for a non-numeric or non-positive value", async () => {
      for (const bad of ["not-a-number", "0", "-5", ""]) {
        const uploadFile = await getUploadFileWith(bad);

        const result = await upload(uploadFile, "attachment", 11 * 1024 * 1024);

        expect(result.error, `UPLOAD_MAX_MB=${bad}`).toContain("10MB");
      }
    });

    it("does not move the avatar ceiling", async () => {
      const uploadFile = await getUploadFileWith("25");

      const result = await upload(uploadFile, "avatar", 3 * 1024 * 1024);

      expect(result.error).toContain("File is too large");
      expect(result.error).toContain("2MB");
    });
  });
});
