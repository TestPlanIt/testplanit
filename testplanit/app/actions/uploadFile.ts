"use server";

import {
  isUploadType,
  putUpload,
  StorageNotConfiguredError,
  validateUpload,
  type UploadType,
} from "~/lib/storageUploads";

interface UploadResult {
  success?: {
    url: string;
    key: string;
  };
  error?: string;
}

/**
 * Server action to upload files to S3/MinIO storage.
 * This bypasses the 1MB route handler limit by using server actions.
 */
export async function uploadFile(
  formData: FormData,
  uploadType: UploadType
): Promise<UploadResult> {
  try {
    // Loaded here, not at module scope: client components import this action
    // through fetchSignedUrl, and the auth module pulls in the whole server.
    const { getServerAuthSession } = await import("~/server/auth");
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { error: "Unauthorized" };
    }

    const file = formData.get("file");
    const prependString = formData.get("prependString");

    if (!(file instanceof File)) {
      return { error: "No file provided" };
    }

    if (!isUploadType(uploadType)) {
      return { error: `Invalid upload type: ${uploadType}` };
    }

    const validationError = validateUpload(file, uploadType);
    if (validationError) {
      return { error: validationError };
    }

    return {
      success: await putUpload(
        file,
        uploadType,
        typeof prependString === "string" ? prependString : null
      ),
    };
  } catch (error: unknown) {
    if (error instanceof StorageNotConfiguredError) {
      return { error: error.message };
    }
    console.error("Upload error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return { error: `Failed to upload file: ${errorMessage}` };
  }
}
