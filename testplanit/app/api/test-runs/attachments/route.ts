/**
 * Test Run Attachments API Route
 *
 * Uploads attachment files and links them to a test run.
 * Used by the CLI to attach artifacts (test plans, docs, etc.) to test runs.
 *
 * Form fields:
 * - files: File[] - The attachment files to upload
 * - testRunId: string - The test run ID to attach files to
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import {
  authenticateApiToken,
  extractBearerToken,
} from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";

interface UploadResult {
  fileName: string;
  success: boolean;
  error?: string;
  attachmentId?: number;
  url?: string;
}

export async function POST(request: NextRequest) {
  // Authenticate user (session or API token)
  const session = await getServerAuthSession();
  let userId = session?.user?.id;

  if (!userId) {
    const token = extractBearerToken(request);
    if (token) {
      const apiAuth = await authenticateApiToken(request);
      if (!apiAuth.authenticated) {
        return NextResponse.json(
          { error: apiAuth.error, code: apiAuth.errorCode },
          { status: 401 }
        );
      }
      userId = apiAuth.userId;
    }
  }

  if (!userId) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const testRunIdStr = formData.get("testRunId") as string;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    if (!testRunIdStr) {
      return NextResponse.json(
        { error: "testRunId is required" },
        { status: 400 }
      );
    }

    // Parse and validate testRunId
    const testRunId = parseInt(testRunIdStr, 10);
    if (isNaN(testRunId) || testRunId <= 0) {
      return NextResponse.json(
        { error: "Invalid testRunId" },
        { status: 400 }
      );
    }

    // Verify the test run exists
    const testRun = await prisma.testRuns.findUnique({
      where: { id: testRunId },
      select: { id: true, projectId: true },
    });

    if (!testRun) {
      return NextResponse.json(
        { error: "Test run not found" },
        { status: 404 }
      );
    }

    // Initialize S3 client
    const bucketName = process.env.AWS_BUCKET_NAME;
    if (!bucketName) {
      return NextResponse.json(
        { error: "Storage bucket not configured" },
        { status: 500 }
      );
    }

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_BUCKET_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      endpoint: process.env.AWS_ENDPOINT_URL,
      forcePathStyle: process.env.AWS_ENDPOINT_URL ? true : false,
    });

    // Process each file
    const results: UploadResult[] = [];

    for (const file of files) {
      const fileName = file.name;

      try {
        // Generate unique object key
        const timestamp = Date.now();
        const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectKey = `uploads/attachments/testrun_${testRunId}_${timestamp}_${sanitizedName}`;

        // Convert File to Buffer
        const buffer = Buffer.from(await file.arrayBuffer());

        // Upload to S3/MinIO
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          Body: buffer,
          ContentType: file.type || "application/octet-stream",
          ContentLength: buffer.length,
        });

        await s3Client.send(command);

        // Create the attachment record linked to test run
        const objectUrl = `/api/storage/${objectKey}`;
        const attachment = await prisma.attachments.create({
          data: {
            url: objectUrl,
            name: fileName,
            mimeType: file.type || "application/octet-stream",
            size: BigInt(buffer.length),
            testRuns: {
              connect: { id: testRunId },
            },
            createdBy: {
              connect: { id: userId },
            },
          },
        });

        results.push({
          fileName,
          success: true,
          attachmentId: attachment.id,
          url: objectUrl,
        });
      } catch (err) {
        console.error(`[Test Run Attachments] Error uploading ${fileName}:`, err);
        results.push({
          fileName,
          success: false,
          error:
            err instanceof Error ? err.message : "Unknown error during upload",
        });
      }
    }

    // Return results summary
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    return NextResponse.json({
      summary: {
        total: results.length,
        success: successCount,
        failed: failureCount,
      },
      results,
    });
  } catch (error) {
    console.error("[Test Run Attachments] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process attachments",
      },
      { status: 500 }
    );
  }
}
