import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "~/lib/api-token-auth";
import { getPresignClient } from "~/lib/s3Client";
import {
  buildUploadKey,
  putUpload,
  StorageNotConfiguredError,
  UPLOAD_CONFIGS,
  validateUpload,
  type UploadType,
} from "~/lib/storageUploads";
import { getServerAuthSession } from "~/server/auth";

// Allowance for multipart boundaries and the non-file form fields.
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

/**
 * Mints a short-lived presigned PUT URL for a browser upload. Browser-only, so
 * a session is required; API clients use the upload routes instead.
 */
export async function handlePresignRequest(
  req: NextRequest,
  uploadType: UploadType
): Promise<NextResponse> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bucketName = process.env.AWS_BUCKET_NAME;
  if (!bucketName) {
    return NextResponse.json(
      { error: "Storage bucket not configured" },
      { status: 500 }
    );
  }

  const prependString = req.nextUrl.searchParams.get("prependString");
  const putObjectCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: buildUploadKey(uploadType, prependString),
  });

  try {
    const signedUrl = await getSignedUrl(getPresignClient(), putObjectCommand, {
      expiresIn: 60,
    });
    return NextResponse.json({ success: { url: signedUrl } });
  } catch (error) {
    console.error("Error generating signed URL", error);
    return NextResponse.json(
      { error: "Error generating signed URL" },
      { status: 500 }
    );
  }
}

/**
 * Server-side multipart upload to S3/MinIO for instances whose storage is not
 * publicly reachable. Accepts a session or an API token.
 */
export async function handleUploadRequest(
  req: NextRequest,
  uploadType: UploadType
): Promise<NextResponse> {
  const auth = await authenticateRequest(req, await getServerAuthSession());
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error, code: auth.errorCode },
      { status: auth.status }
    );
  }

  const contentLength = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength >
      UPLOAD_CONFIGS[uploadType].maxSize + MULTIPART_OVERHEAD_BYTES
  ) {
    return NextResponse.json({ error: "File is too large." }, { status: 413 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const prependString = formData.get("prependString");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const validationError = validateUpload(file, uploadType);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    return NextResponse.json({
      success: await putUpload(
        file,
        uploadType,
        typeof prependString === "string" ? prependString : null
      ),
    });
  } catch (error: unknown) {
    if (error instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    console.error("Upload error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to upload file: ${message}` },
      { status: 500 }
    );
  }
}
