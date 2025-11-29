/**
 * Converts MinIO/S3 storage URLs to proxy URLs for hosted instances.
 *
 * For hosted instances where MinIO is not publicly accessible, URLs like:
 *   http://testplanit-shared-minio:9000/bucket-name/uploads/file.png
 *
 * Are converted to:
 *   https://subdomain.testplanit.com/api/storage/uploads/file.png
 *
 * For self-hosted instances with public S3/MinIO, URLs are returned unchanged.
 */
export function getStorageUrl(minioUrl: string | null | undefined): string | null {
  if (!minioUrl) return null;

  // Check if this is a hosted instance without public MinIO access
  const isHosted = process.env.IS_HOSTED === "true";
  const hasPublicEndpoint = !!process.env.AWS_PUBLIC_ENDPOINT_URL;

  // If not a hosted instance or has public endpoint, return original URL
  if (!isHosted || hasPublicEndpoint) {
    return minioUrl;
  }

  try {
    const url = new URL(minioUrl);
    const bucketName = process.env.AWS_BUCKET_NAME;

    // Extract the object key from the URL path
    // Path format: /bucket-name/uploads/path/to/file.ext
    let objectKey = url.pathname;

    // Remove leading slash
    if (objectKey.startsWith("/")) {
      objectKey = objectKey.substring(1);
    }

    // Remove bucket name prefix if present
    if (bucketName && objectKey.startsWith(`${bucketName}/`)) {
      objectKey = objectKey.substring(bucketName.length + 1);
    }

    // Return proxy URL
    // This will be relative to the current domain (e.g., subdomain.testplanit.com)
    return `/api/storage/${objectKey}`;
  } catch (error) {
    console.error("Failed to convert storage URL:", error);
    return minioUrl; // Fallback to original URL
  }
}

/**
 * Client-side version of getStorageUrl.
 * This is used in browser components to convert URLs before rendering.
 * Works for both hosted instances (trials and paid) where MinIO is not publicly accessible.
 */
export function getStorageUrlClient(minioUrl: string | null | undefined): string | null {
  if (!minioUrl) return null;

  // Client-side detection: check if URL points to internal MinIO hostname
  // This applies to all hosted instances, not just trials
  const isInternalMinioUrl =
    minioUrl.includes("testplanit-shared-minio") ||
    minioUrl.includes("minio:9000") ||
    minioUrl.startsWith("http://") && minioUrl.includes(":9000");

  // If it's an internal MinIO URL, convert to proxy URL
  if (isInternalMinioUrl) {
    try {
      const url = new URL(minioUrl);
      let objectKey = url.pathname;

      // Remove leading slash
      if (objectKey.startsWith("/")) {
        objectKey = objectKey.substring(1);
      }

      // Remove bucket name prefix (extract from URL or guess pattern)
      // Bucket names typically follow pattern: testplanit-{subdomain}
      const bucketMatch = objectKey.match(/^testplanit-[^/]+\/(.*)/);
      if (bucketMatch) {
        objectKey = bucketMatch[1];
      }

      return `/api/storage/${objectKey}`;
    } catch (error) {
      console.error("Failed to convert storage URL:", error);
      return minioUrl;
    }
  }

  // Otherwise, return original URL (likely a public S3/CDN URL)
  return minioUrl;
}
