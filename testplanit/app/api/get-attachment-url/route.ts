import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getPresignClient } from "~/lib/s3Client";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";

// S3 client for presigned URL generation (uses public endpoint if available)
const presignClient = getPresignClient();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const prependString = searchParams.get("prependString") || "unknown";

  const putObjectCommand = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: `uploads/attachments/${prependString}_${Date.now()}`,
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
