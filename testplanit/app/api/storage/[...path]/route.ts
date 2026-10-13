import { GetObjectCommand } from "@aws-sdk/client-s3";
import { authenticateRequest } from "~/lib/api-token-auth";
import { getS3Client } from "~/lib/s3Client";
import { getServerAuthSession } from "~/server/auth";
import { NextRequest, NextResponse } from "next/server";
import { Readable } from "stream";

// Types the app renders inline when the URL is opened directly. Anything else
// (HTML, SVG, XML, scripts, archives…) is served as a download so uploaded
// content can never run as a page on the app origin.
const INLINE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "application/pdf",
  "text/plain",
]);

function isInlineContentType(contentType: string): boolean {
  return (
    INLINE_CONTENT_TYPES.has(contentType) ||
    contentType.startsWith("video/") ||
    contentType.startsWith("audio/")
  );
}

function isValidObjectPath(path: string[]): boolean {
  return (
    path.length >= 2 &&
    path[0] === "uploads" &&
    path.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        !/[\\\0]/.test(segment)
    )
  );
}

/**
 * GET /api/storage/[...path]
 *
 * Proxies asset requests from browser to MinIO/S3.
 * This is necessary for instances where MinIO is not publicly accessible.
 *
 * Example: GET /api/storage/uploads/project-icons/icon_123.png
 * Fetches: s3://bucket-name/uploads/project-icons/icon_123.png
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const auth = await authenticateRequest(req, await getServerAuthSession());
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error, code: auth.errorCode },
      { status: auth.status }
    );
  }

  const { path } = await params;
  if (!isValidObjectPath(path)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  try {
    // Create S3 client inside the request handler to ensure env vars are available
    const s3Client = getS3Client();
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

    const contentType = response.ContentType || "application/octet-stream";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length":
        response.ContentLength?.toString() || buffer.length.toString(),
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: response.ETag || "",
      "X-Content-Type-Options": "nosniff",
    };
    if (!isInlineContentType(mediaType)) {
      headers["Content-Disposition"] = "attachment";
    }
    // Chrome's PDF viewer refuses to render under a sandbox CSP.
    if (mediaType !== "application/pdf") {
      headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
    }

    return new NextResponse(buffer, { status: 200, headers });
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
