/**
 * JUnit Attachment API Route
 *
 * Creates an attachment linked to a JUnit test result.
 * This endpoint handles BigInt conversion for the size field since JSON doesn't support BigInt.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSession } from "~/server/auth";
import { authenticateApiToken, extractBearerToken } from "~/lib/api-token-auth";
import { prisma } from "~/lib/prisma";
import { z } from "zod";

const attachmentSchema = z.object({
  junitTestResultId: z.number().int().positive(),
  // URL can be a full URL or a relative path (e.g., /api/storage/...)
  url: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().default("application/octet-stream"),
  size: z.union([z.number(), z.string()]).transform((val) => BigInt(val)),
  note: z.string().optional(),
});

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
    const body = await request.json();
    const validatedData = attachmentSchema.parse(body);

    // Verify the JUnit test result exists
    const junitResult = await prisma.jUnitTestResult.findUnique({
      where: { id: validatedData.junitTestResultId },
      select: { id: true },
    });

    if (!junitResult) {
      return NextResponse.json(
        { error: "JUnit test result not found" },
        { status: 404 }
      );
    }

    // Create the attachment with BigInt size
    const attachment = await prisma.attachments.create({
      data: {
        url: validatedData.url,
        name: validatedData.name,
        mimeType: validatedData.mimeType,
        size: validatedData.size,
        note: validatedData.note || null,
        junitTestResult: {
          connect: { id: validatedData.junitTestResultId },
        },
        createdBy: {
          connect: { id: userId },
        },
      },
    });

    // Convert BigInt to string for JSON response
    return NextResponse.json({
      data: {
        ...attachment,
        size: attachment.size.toString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.issues },
        { status: 400 }
      );
    }

    console.error("[JUnit Attachment] Error creating attachment:", error);
    return NextResponse.json(
      { error: "Failed to create attachment" },
      { status: 500 }
    );
  }
}
