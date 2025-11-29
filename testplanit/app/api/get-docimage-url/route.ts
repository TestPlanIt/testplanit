import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// S3 client for presigned URL generation (uses public endpoint if available)
const presignClient = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  endpoint: process.env.AWS_PUBLIC_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL,
  forcePathStyle: process.env.AWS_ENDPOINT_URL ? true : false,
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prependString = searchParams.get("prependString") || "unknown";

  const putObjectCommand = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: `uploads/documentation-images/${prependString}_${Date.now()}`,
  });

  try {
    const signedUrl = await getSignedUrl(presignClient, putObjectCommand, {
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
