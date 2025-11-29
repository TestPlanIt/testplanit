import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

/**
 * GET /api/storage/[...path]
 *
 * Proxies asset requests from browser to MinIO/S3.
 * This is necessary for trial instances where MinIO is not publicly accessible.
 *
 * Example: GET /api/storage/uploads/project-icons/icon_123.png
 * Fetches: s3://bucket-name/uploads/project-icons/icon_123.png
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
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
    const { path } = await params;
    const objectKey = path.join("/");

    const bucketName = process.env.AWS_BUCKET_NAME;
    if (!bucketName) {
      return NextResponse.json(
        { error: "Storage bucket not configured" },
        { status: 500 }
      );
    }

    // Fetch object from S3/MinIO
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Convert the S3 Body to a buffer
    const chunks: Uint8Array[] = [];
    const body = response.Body as Readable;

    for await (const chunk of body) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);

    // Return the file with appropriate headers
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": response.ContentType || "application/octet-stream",
        "Content-Length": response.ContentLength?.toString() || buffer.length.toString(),
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": response.ETag || "",
      },
    });
  } catch (error: any) {
    console.error("Storage proxy error:", error);

    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to fetch file" },
      { status: 500 }
    );
  }
}
