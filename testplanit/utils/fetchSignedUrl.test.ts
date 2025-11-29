import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSignedUrl } from "./fetchSignedUrl";

// Helper to create mock File objects
const createMockFile = (name: string, type: string, size: number): File => {
  const blob = new Blob([new ArrayBuffer(size)], { type });
  return new File([blob], name, { type });
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
  });

  afterEach(() => {
    // Restore fetch after each test
    vi.restoreAllMocks();
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
});
