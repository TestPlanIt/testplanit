import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { authOptions } from "~/server/auth";

const bucketName = process.env.AWS_BUCKET_NAME;

const s3Client = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  endpoint: process.env.AWS_PUBLIC_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL,
  forcePathStyle: Boolean(process.env.AWS_ENDPOINT_URL),
});

export async function POST(request: NextRequest) {
  try {
    if (!bucketName) {
      return NextResponse.json(
        { error: "Storage bucket is not configured" },
        { status: 500 }
      );
    }

    const session = await getServerSession(authOptions);

    if (!session || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { fileName, contentType } = await request.json();

    if (!fileName || typeof fileName !== "string") {
      return NextResponse.json(
        { error: "File name is required" },
        { status: 400 }
      );
    }

    const normalizedContentType =
      typeof contentType === "string" && contentType.length > 0
        ? contentType
        : "application/octet-stream";

    const uniqueId = randomUUID();
    const sanitizedName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const objectKey = `uploads/imports/testmo/${uniqueId}-${sanitizedName}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      ContentType: normalizedContentType,
    });

    // Larger Testmo exports can take time to PUT, so provide a generous URL window.
    const url = await getSignedUrl(s3Client, command, { expiresIn: 15 * 60 });

    return NextResponse.json({ url, key: objectKey, bucket: bucketName });
  } catch (error) {
    console.error("Failed to generate Testmo import upload URL", error);
    return NextResponse.json(
      { error: "Failed to generate upload URL" },
      { status: 500 }
    );
  }
}
