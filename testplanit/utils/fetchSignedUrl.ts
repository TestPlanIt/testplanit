import { uploadFile } from "~/app/actions/uploadFile";

/**
 * Detects if the current environment should use server-side upload proxy.
 * Returns true for multi-tenant/hosted instances when MinIO is not publicly accessible.
 *
 * Detection methods (in order of priority):
 * 1. Global __STORAGE_MODE__ variable set in HTML head (most reliable)
 * 2. Meta tag storage-mode
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

// Map API endpoints to upload types for server action
type UploadType = "project-icon" | "avatar" | "docimage" | "attachment";

function getUploadType(presignedEndpoint: string): UploadType | null {
  const normalized = presignedEndpoint.split('?')[0].replace(/\/$/, '');

  const endpointMap: Record<string, UploadType> = {
    "/api/get-project-icon-url": "project-icon",
    "/api/get-avatar-url": "avatar",
    "/api/get-docimage-url": "docimage",
    "/api/get-attachment-url": "attachment",
  };

  return endpointMap[normalized] || null;
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
      // Server action approach (for hosted instances)
      // This bypasses the 1MB route handler body size limit
      const uploadType = getUploadType(apiEndpoint);
      if (!uploadType) {
        throw new Error(`Unsupported upload endpoint: ${apiEndpoint}`);
      }

      const formData = new FormData();
      formData.append("file", file);
      if (prependString) {
        formData.append("prependString", prependString);
      }

      const result = await uploadFile(formData, uploadType);
      if (result.error) {
        throw new Error(result.error);
      }

      return result.success!.url;
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
