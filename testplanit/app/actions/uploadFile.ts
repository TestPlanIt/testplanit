"use server";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Supported upload types and their configurations
const UPLOAD_CONFIGS = {
  "project-icon": {
    folder: "uploads/project-icons",
    maxSize: 4 * 1024 * 1024, // 4MB
  },
  "avatar": {
    folder: "uploads/avatars",
    maxSize: 2 * 1024 * 1024, // 2MB
  },
  "docimage": {
    folder: "uploads/document-images",
    maxSize: 10 * 1024 * 1024, // 10MB
  },
  "attachment": {
    folder: "uploads/attachments",
    maxSize: 10 * 1024 * 1024, // 10MB
  },
} as const;

type UploadType = keyof typeof UPLOAD_CONFIGS;

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
    const file = formData.get("file") as File;
    const prependString = (formData.get("prependString") as string) || "";

    if (!file) {
      return { error: "No file provided" };
    }

    const config = UPLOAD_CONFIGS[uploadType];
    if (!config) {
      return { error: `Invalid upload type: ${uploadType}` };
    }

    // Validate file size
    if (file.size > config.maxSize) {
      return {
        error: `File is too large. Maximum size is ${config.maxSize / (1024 * 1024)}MB.`,
      };
    }

    const bucketName = process.env.AWS_BUCKET_NAME;
    if (!bucketName) {
      return { error: "Storage bucket not configured" };
    }

    // Create S3 client
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      endpoint: process.env.AWS_ENDPOINT_URL,
      forcePathStyle: process.env.AWS_ENDPOINT_URL ? true : false,
    });

    const objectKey = `${config.folder}/${prependString}${prependString ? "_" : ""}${Date.now()}_${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: file.type,
      ContentLength: buffer.length,
    });

    await s3Client.send(command);

    const objectUrl = `/api/storage/${objectKey}`;

    return {
      success: {
        url: objectUrl,
        key: objectKey,
      },
    };
  } catch (error: unknown) {
    console.error("Upload error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { error: `Failed to upload file: ${errorMessage}` };
  }
}
