import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSignedUrl } from "./fetchSignedUrl";

// Helper to create mock File objects
const createMockFile = (name: string, type: string, size: number): File => {
  const blob = new Blob([new ArrayBuffer(size)], { type });
  return new File([blob], name, { type });
};

// Helper to set storage mode
const setStorageMode = (mode: "proxy" | "direct" | null) => {
  if (mode) {
    (window as any).__STORAGE_MODE__ = mode;
  } else {
    delete (window as any).__STORAGE_MODE__;
  }
};

describe("fetchSignedUrl", () => {
  const apiEndpoint = "/api/upload-url";
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Mock global fetch before each test
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
    // Silence console.error for this suite to avoid expected error noise in logs
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Default to direct mode (no proxy)
    setStorageMode(null);
  });

  afterEach(() => {
    // Restore fetch after each test
    vi.restoreAllMocks();
    // Clean up storage mode
    setStorageMode(null);
  });

  // --- Validation Tests ---

  it("should throw error if restrictToImages is true and file is not an image", async () => {
    const file = createMockFile("test.txt", "text/plain", 100);
    await expect(
      fetchSignedUrl(file, apiEndpoint, undefined, true)
    ).rejects.toThrow("Please select an image file.");
  });

  it("should NOT throw error if restrictToImages is true and file is an image", async () => {
    const file = createMockFile("test.png", "image/png", 100);
    // Mock fetch to prevent actual calls during validation phase testing
    mockFetch.mockResolvedValue({ ok: false }); // Simulate failure to stop execution early
    await expect(
      fetchSignedUrl(file, apiEndpoint, undefined, true)
    ).rejects.toThrow(); // Expecting throw due to mocked fetch, *not* the image type error
    expect(mockFetch).toHaveBeenCalled(); // Ensure fetch was actually called (validation passed)
  });

  it("should NOT throw error if restrictToImages is false and file is not an image", async () => {
    const file = createMockFile("test.txt", "text/plain", 100);
    mockFetch.mockResolvedValue({ ok: false });
    await expect(
      fetchSignedUrl(file, apiEndpoint, undefined, false)
    ).rejects.toThrow(); // Expecting throw due to mocked fetch
    expect(mockFetch).toHaveBeenCalled(); // Ensure fetch was called
  });

  it("should throw error if file size exceeds maxFileSize", async () => {
    const file = createMockFile(
      "large.bin",
      "application/octet-stream",
      20 * 1024 * 1024
    );
    const maxSize = 10 * 1024 * 1024; // 10 MB
    await expect(
      fetchSignedUrl(file, apiEndpoint, undefined, false, maxSize)
    ).rejects.toThrow(
      "File is too large. Please select a file smaller than 10MB."
    );
  });

  it("should NOT throw error if file size is within maxFileSize", async () => {
    const file = createMockFile(
      "small.bin",
      "application/octet-stream",
      5 * 1024 * 1024
    );
    const maxSize = 10 * 1024 * 1024; // 10 MB
    mockFetch.mockResolvedValue({ ok: false });
    await expect(
      fetchSignedUrl(file, apiEndpoint, undefined, false, maxSize)
    ).rejects.toThrow(); // Expecting throw due to mocked fetch
    expect(mockFetch).toHaveBeenCalled(); // Ensure fetch was called
  });

  // --- Network Tests ---

  it("should successfully fetch signed URL, upload file, and return base URL", async () => {
    const file = createMockFile("image.jpg", "image/jpeg", 1024);
    const mockSignedUrl =
      "https://s3.bucket/upload/image.jpg?sig=xyz&expiry=123";
    const expectedBaseUrl = "https://s3.bucket/upload/image.jpg";

    // Mock first fetch (get signed URL)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: { url: mockSignedUrl } }),
    });
    // Mock second fetch (PUT upload)
    mockFetch.mockResolvedValueOnce({
      ok: true,
    });

    const result = await fetchSignedUrl(file, apiEndpoint);

    expect(result).toBe(expectedBaseUrl);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Check first call args
    expect(mockFetch).toHaveBeenNthCalledWith(1, apiEndpoint);
    // Check second call args
    expect(mockFetch).toHaveBeenNthCalledWith(2, mockSignedUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });
  });

  it("should use prependString when fetching signed URL", async () => {
    const file = createMockFile("image.jpg", "image/jpeg", 1024);
    const prepend = "user/data/";
    const expectedApiUrl = `${apiEndpoint}?prependString=${prepend}`;
    const mockSignedUrl =
      "https://s3.bucket/upload/image.jpg?sig=xyz&expiry=123";

    mockFetch.mockResolvedValueOnce({
      // Signed URL fetch
      ok: true,
      json: async () => ({ success: { url: mockSignedUrl } }),
    });
    mockFetch.mockResolvedValueOnce({ ok: true }); // Upload fetch

    await fetchSignedUrl(file, apiEndpoint, prepend);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, expectedApiUrl); // Verify URL used for first fetch
  });

  it("should throw error if fetching signed URL fails (network error)", async () => {
    const file = createMockFile("image.jpg", "image/jpeg", 1024);
    mockFetch.mockResolvedValueOnce({
      // Signed URL fetch fails
      ok: false,
      status: 500,
    });

    await expect(fetchSignedUrl(file, apiEndpoint)).rejects.toThrow(
      "Error uploading file. Please try again."
    );
    // Check that the second fetch was NOT made
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should throw error if fetching signed URL fails (JSON error)", async () => {
    const file = createMockFile("image.jpg", "image/jpeg", 1024);
    mockFetch.mockResolvedValueOnce({
      // Signed URL fetch succeeds but returns error
      ok: true,
      json: async () => ({ error: "Backend permission denied" }),
    });

    await expect(fetchSignedUrl(file, apiEndpoint)).rejects.toThrow(
      "Error uploading file. Please try again." // Function wraps specific error
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("should throw error if file upload fails (network error)", async () => {
    const file = createMockFile("image.jpg", "image/jpeg", 1024);
    const mockSignedUrl =
      "https://s3.bucket/upload/image.jpg?sig=xyz&expiry=123";

    mockFetch.mockResolvedValueOnce({
      // Signed URL fetch OK
      ok: true,
      json: async () => ({ success: { url: mockSignedUrl } }),
    });
    mockFetch.mockResolvedValueOnce({
      // Upload fetch fails
      ok: false,
      status: 403,
    });

    await expect(fetchSignedUrl(file, apiEndpoint)).rejects.toThrow(
      "Error uploading file. Please try again."
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // --- Proxy Mode Tests (for hosted instances without public MinIO) ---

  describe("proxy mode", () => {
    beforeEach(() => {
      setStorageMode("proxy");
    });

    it("should use POST upload endpoint when in proxy mode", async () => {
      const file = createMockFile("image.jpg", "image/jpeg", 1024);
      const mockProxyUrl = "/api/storage/uploads/docimages/1_image.jpg";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: { url: mockProxyUrl } }),
      });

      const result = await fetchSignedUrl(file, "/api/get-docimage-url");

      expect(result).toBe(mockProxyUrl);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      // Verify it called the upload endpoint, not the get-url endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/upload-docimage",
        expect.objectContaining({
          method: "POST",
          body: expect.any(FormData),
        })
      );
    });

    it("should include prependString in FormData when in proxy mode", async () => {
      const file = createMockFile("test.png", "image/png", 512);
      const prependString = "project123/test.png";
      const mockProxyUrl = "/api/storage/uploads/docimages/project123_test.png";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: { url: mockProxyUrl } }),
      });

      await fetchSignedUrl(file, "/api/get-docimage-url", prependString);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, options] = mockFetch.mock.calls[0];
      const formData = options.body as FormData;
      expect(formData.get("file")).toBe(file);
      expect(formData.get("prependString")).toBe(prependString);
    });

    it("should map get-attachment-url to upload-attachment in proxy mode", async () => {
      const file = createMockFile("doc.pdf", "application/pdf", 2048);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: { url: "/api/storage/uploads/attachments/doc.pdf" } }),
      });

      await fetchSignedUrl(file, "/api/get-attachment-url");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/upload-attachment",
        expect.any(Object)
      );
    });

    it("should map get-avatar-url to upload-avatar in proxy mode", async () => {
      const file = createMockFile("avatar.png", "image/png", 1024);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: { url: "/api/storage/uploads/avatars/avatar.png" } }),
      });

      await fetchSignedUrl(file, "/api/get-avatar-url");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/upload-avatar",
        expect.any(Object)
      );
    });

    it("should map get-project-icon-url to upload-project-icon in proxy mode", async () => {
      const file = createMockFile("icon.png", "image/png", 512);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: { url: "/api/storage/uploads/project-icons/icon.png" } }),
      });

      await fetchSignedUrl(file, "/api/get-project-icon-url");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/upload-project-icon",
        expect.any(Object)
      );
    });

    it("should throw error if proxy upload fails", async () => {
      const file = createMockFile("image.jpg", "image/jpeg", 1024);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        fetchSignedUrl(file, "/api/get-docimage-url")
      ).rejects.toThrow("Error uploading file. Please try again.");
    });

    it("should throw error if proxy upload returns error in response", async () => {
      const file = createMockFile("image.jpg", "image/jpeg", 1024);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: "Storage bucket not configured" }),
      });

      await expect(
        fetchSignedUrl(file, "/api/get-docimage-url")
      ).rejects.toThrow("Error uploading file. Please try again.");
    });

    it("should still validate file type before upload in proxy mode", async () => {
      const file = createMockFile("doc.txt", "text/plain", 100);

      await expect(
        fetchSignedUrl(file, "/api/get-docimage-url", undefined, true)
      ).rejects.toThrow("Please select an image file.");

      // Fetch should NOT have been called due to early validation
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should still validate file size before upload in proxy mode", async () => {
      const file = createMockFile("huge.jpg", "image/jpeg", 20 * 1024 * 1024);
      const maxSize = 10 * 1024 * 1024;

      await expect(
        fetchSignedUrl(file, "/api/get-docimage-url", undefined, false, maxSize)
      ).rejects.toThrow("File is too large");

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // --- Direct Mode Tests (explicit) ---

  describe("direct mode", () => {
    beforeEach(() => {
      setStorageMode("direct");
    });

    it("should use presigned URL approach when in direct mode", async () => {
      const file = createMockFile("image.jpg", "image/jpeg", 1024);
      const mockSignedUrl = "https://s3.bucket/upload/image.jpg?sig=xyz";

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: { url: mockSignedUrl } }),
      });
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await fetchSignedUrl(file, "/api/get-docimage-url");

      expect(result).toBe("https://s3.bucket/upload/image.jpg");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // First call: get presigned URL
      expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/get-docimage-url");
      // Second call: PUT to S3
      expect(mockFetch).toHaveBeenNthCalledWith(2, mockSignedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": "image/jpeg" },
      });
    });
  });
});
