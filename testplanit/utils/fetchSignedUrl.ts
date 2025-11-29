/**
 * Detects if the current environment should use server-side upload proxy.
 * Returns true for hosted instances (trials and paid) when MinIO is not publicly accessible.
 */
function shouldUseUploadProxy(): boolean {
  // Check if we're in a browser environment
  if (typeof window === "undefined") return false;

  // First check for global variable (set immediately in HTML head, most reliable)
  const globalMode = (window as { __STORAGE_MODE__?: string }).__STORAGE_MODE__;
  if (globalMode) {
    return globalMode === "proxy";
  }

  // Fallback: check meta tag (may not be available during early hydration)
  const meta = document.querySelector('meta[name="storage-mode"]');
  if (meta) {
    const mode = meta.getAttribute("content");
    return mode === "proxy";
  }

  // Default: assume proxy is NOT needed (standard S3/public MinIO)
  return false;
}

/**
 * Converts GET presigned URL endpoints to POST upload endpoints.
 * Example: /api/get-attachment-url/ -> /api/upload-attachment
 */
function getUploadEndpoint(presignedEndpoint: string): string {
  // Normalize endpoint (remove trailing slash and query params)
  const normalized = presignedEndpoint.split('?')[0].replace(/\/$/, '');

  const endpointMap: Record<string, string> = {
    "/api/get-attachment-url": "/api/upload-attachment",
    "/api/get-project-icon-url": "/api/upload-project-icon",
    "/api/get-avatar-url": "/api/upload-avatar",
    "/api/get-docimage-url": "/api/upload-docimage",
    "/api/imports/testmo/upload-url": "/api/upload-testmo-import",
  };

  return endpointMap[normalized] || normalized.replace("/get-", "/upload-").replace("-url", "");
}

export async function fetchSignedUrl(
  file: File,
  apiEndpoint: string,
  prependString?: string,
  restrictToImages: boolean = false,
  maxFileSize: number = 1 * 1024 * 1024 * 1024 // Default to 1GB
): Promise<string> {
  if (restrictToImages && !file.type.startsWith("image/")) {
    throw new Error("Please select an image file.");
  }

  if (file.size > maxFileSize) {
    throw new Error(
      `File is too large. Please select a file smaller than ${maxFileSize / (1024 * 1024)}MB.`
    );
  }

  try {
    // Detect if we should use server-side upload proxy
    const useProxy = shouldUseUploadProxy();

    if (useProxy) {
      // Server-side upload proxy approach (for hosted instances)
      const uploadEndpoint = getUploadEndpoint(apiEndpoint);
      const formData = new FormData();
      formData.append("file", file);
      if (prependString) {
        formData.append("prependString", prependString);
      }

      const uploadResponse = await fetch(uploadEndpoint, {
        method: "POST",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error(`HTTP error! status: ${uploadResponse.status}`);
      }

      const uploadData = await uploadResponse.json();
      if (uploadData.error) throw new Error(uploadData.error);

      return uploadData.success.url;
    } else {
      // Standard presigned URL approach (for public S3/MinIO)
      const urlWithPrepend = prependString
        ? `${apiEndpoint}?prependString=${prependString}`
        : apiEndpoint;

      const signedUrlResponse = await fetch(urlWithPrepend);
      if (!signedUrlResponse.ok) {
        throw new Error(`HTTP error! status: ${signedUrlResponse.status}`);
      }
      const signedUrlData = await signedUrlResponse.json();
      if (signedUrlData.error) throw new Error(signedUrlData.error);

      const { url } = signedUrlData.success;

      const uploadResponse = await fetch(url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`HTTP error! status: ${uploadResponse.status}`);
      }

      return url.split("?")[0];
    }
  } catch (error) {
    console.error("Error uploading file:", error);
    throw new Error("Error uploading file. Please try again.");
  }
}
