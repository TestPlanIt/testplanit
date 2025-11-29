import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * POST /api/upload-attachment
 *
 * Server-side file upload proxy for trial instances.
 * Accepts multipart/form-data, uploads to MinIO/S3, returns object URL.
 *
 * Form fields:
 * - file: The file to upload (required)
 * - prependString: Prefix for the object key (optional)
 */
export async function POST(req: NextRequest) {
  try {
    // Create S3 client inside the request handler to ensure env vars are available
    const s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      endpoint: process.env.AWS_ENDPOINT_URL, // Always use internal endpoint for server-side access
      forcePathStyle: process.env.AWS_ENDPOINT_URL ? true : false,
    });
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const prependString = formData.get("prependString") as string || "";

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    const bucketName = process.env.AWS_BUCKET_NAME;
    if (!bucketName) {
      return NextResponse.json(
        { error: "Storage bucket not configured" },
        { status: 500 }
      );
    }

    // Generate object key
    const objectKey = `uploads/attachments/${prependString}${prependString ? "_" : ""}${Date.now()}_${file.name}`;

    // Convert File to Buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload to S3/MinIO
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: buffer,
      ContentType: file.type,
      ContentLength: buffer.length,
    });

    await s3Client.send(command);

    // Return the object URL (proxy URL for trial instances)
    const objectUrl = `/api/storage/${objectKey}`;

    return NextResponse.json({
      success: {
        url: objectUrl,
        key: objectKey,
      },
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });
    return NextResponse.json(
      { error: `Failed to upload file: ${error.message || 'Unknown error'}` },
      { status: 500 }
    );
  }
}
