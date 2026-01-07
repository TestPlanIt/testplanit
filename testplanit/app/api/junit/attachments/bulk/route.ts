/**
 * Bulk JUnit Attachment Upload API Route
 *
 * Accepts multiple attachment files and links them to JUnit test results.
 * Used by the CLI to upload attachments after importing test results.
 *
 * Form fields:
 * - files: File[] - The attachment files to upload
 * - mappings: JSON string - Array of { fileName, junitTestResultId }
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

const mappingSchema = z.array(
  z.object({
    fileName: z.string().min(1),
    junitTestResultId: z.number().int().positive(),
  })
);

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
    const mappingsJson = formData.get("mappings") as string;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    if (!mappingsJson) {
      return NextResponse.json(
        { error: "No mappings provided" },
        { status: 400 }
      );
    }

    // Parse and validate mappings
    let mappings: z.infer<typeof mappingSchema>;
    try {
      const parsed = JSON.parse(mappingsJson);
      mappings = mappingSchema.parse(parsed);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: "Invalid mappings format", details: err.issues },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: "Failed to parse mappings JSON" },
        { status: 400 }
      );
    }

    // Create a map of fileName -> junitTestResultId for quick lookup
    const fileToResultMap = new Map<string, number>();
    for (const mapping of mappings) {
      fileToResultMap.set(mapping.fileName, mapping.junitTestResultId);
    }

    // Verify all JUnit test results exist
    const resultIds = [...new Set(mappings.map((m) => m.junitTestResultId))];
    const existingResults = await prisma.jUnitTestResult.findMany({
      where: { id: { in: resultIds } },
      select: { id: true },
    });
    const existingIds = new Set(existingResults.map((r) => r.id));

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
      const junitTestResultId = fileToResultMap.get(fileName);

      // Check if we have a mapping for this file
      if (junitTestResultId === undefined) {
        results.push({
          fileName,
          success: false,
          error: "No mapping found for this file",
        });
        continue;
      }

      // Check if the JUnit test result exists
      if (!existingIds.has(junitTestResultId)) {
        results.push({
          fileName,
          success: false,
          error: `JUnit test result ${junitTestResultId} not found`,
        });
        continue;
      }

      try {
        // Generate unique object key
        const timestamp = Date.now();
        const objectKey = `uploads/attachments/junit_${junitTestResultId}_${timestamp}_${fileName}`;

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

        // Create the attachment record
        const objectUrl = `/api/storage/${objectKey}`;
        const attachment = await prisma.attachments.create({
          data: {
            url: objectUrl,
            name: fileName,
            mimeType: file.type || "application/octet-stream",
            size: BigInt(buffer.length),
            junitTestResult: {
              connect: { id: junitTestResultId },
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
        console.error(`[Bulk Upload] Error uploading ${fileName}:`, err);
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
    console.error("[Bulk Attachment Upload] Error:", error);
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
