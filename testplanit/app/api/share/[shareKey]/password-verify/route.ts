import { NextRequest, NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import bcrypt from "bcrypt";
import {
  checkPasswordAttemptLimit,
  recordPasswordAttempt,
  clearPasswordAttempts,
} from "~/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/share/[shareKey]/password-verify
 * Verify password for password-protected share link
 * Rate limited to prevent brute force attacks
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shareKey: string }> }
) {
  try {
    const { shareKey } = await params;
    const body = await req.json();
    const { password } = body;

    if (!password) {
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 }
      );
    }

    // Get IP address for rate limiting
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    // Create rate limit identifier (shareKey + IP)
    const rateLimitId = `${shareKey}:${ipAddress}`;

    // Check rate limit
    const rateLimit = checkPasswordAttemptLimit(rateLimitId);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: "Too many failed attempts. Please try again later.",
          rateLimited: true,
          resetAt: rateLimit.resetAt,
        },
        { status: 429 }
      );
    }

    // Fetch share link
    const shareLink = await prisma.shareLink.findUnique({
      where: { shareKey },
      select: {
        id: true,
        passwordHash: true,
        mode: true,
        isRevoked: true,
        expiresAt: true,
      },
    });

    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found" },
        { status: 404 }
      );
    }

    // Check if revoked
    if (shareLink.isRevoked) {
      return NextResponse.json(
        { error: "This share link has been revoked" },
        { status: 403 }
      );
    }

    // Check if expired
    if (shareLink.expiresAt && new Date(shareLink.expiresAt) < new Date()) {
      return NextResponse.json(
        { error: "This share link has expired" },
        { status: 403 }
      );
    }

    // Verify mode is PASSWORD_PROTECTED
    if (shareLink.mode !== "PASSWORD_PROTECTED") {
      return NextResponse.json(
        { error: "This share link does not require a password" },
        { status: 400 }
      );
    }

    if (!shareLink.passwordHash) {
      return NextResponse.json(
        { error: "Password protection not configured for this link" },
        { status: 500 }
      );
    }

    // Verify password
    const isValid = await bcrypt.compare(password, shareLink.passwordHash);

    if (!isValid) {
      // Record failed attempt
      recordPasswordAttempt(rateLimitId);

      // Get updated rate limit info
      const updatedRateLimit = checkPasswordAttemptLimit(rateLimitId);

      return NextResponse.json(
        {
          error: "Invalid password",
          remainingAttempts: updatedRateLimit.remainingAttempts,
        },
        { status: 401 }
      );
    }

    // Password is valid, clear rate limit
    clearPasswordAttempts(rateLimitId);

    // Return success (client will store this in sessionStorage)
    return NextResponse.json({
      success: true,
      token: shareKey, // Use shareKey as simple token
      expiresIn: 3600, // 1 hour in seconds
    });
  } catch (error) {
    console.error("Error verifying password:", error);
    return NextResponse.json(
      { error: "Failed to verify password" },
      { status: 500 }
    );
  }
}
