import { NextRequest, NextResponse } from "next/server";
import { prisma } from "~/lib/prisma";
import crypto from "crypto";

/**
 * POST /api/auth/send-magic-link
 *
 * Sends a magic link email to the specified email address.
 * Used by the provisioning worker to send the initial magic link to new trial admins.
 *
 * Body:
 * - email: The email address to send the magic link to
 * - callbackUrl: Optional callback URL (defaults to home page)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, callbackUrl = "/" } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Check if user exists and is active
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, isActive: true },
    });

    if (!user || !user.isActive) {
      // Still return success to prevent enumeration
      return NextResponse.json({
        success: true,
        message: "If a user with that email exists, a magic link has been sent",
      });
    }

    // Generate a verification token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Hash the token before storing - NextAuth uses sha256(token + secret)
    // When user clicks the link, NextAuth hashes the URL token and looks up the hash
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      throw new Error("NEXTAUTH_SECRET is not configured");
    }
    const hashedToken = crypto
      .createHash("sha256")
      .update(`${token}${secret}`)
      .digest("hex");

    // Store the hashed token in the database
    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token: hashedToken,
        expires,
      },
    });

    // Build the magic link URL
    const protocol = process.env.NEXTAUTH_URL?.startsWith("https") ? "https" : "http";
    const host = req.headers.get("host") || process.env.NEXTAUTH_URL?.replace(/^https?:\/\//, "");
    const baseUrl = `${protocol}://${host}`;

    // Ensure callbackUrl has a trailing slash for proper routing
    let finalCallbackUrl = callbackUrl.startsWith("http") ? callbackUrl : baseUrl + callbackUrl;
    if (!finalCallbackUrl.endsWith("/")) {
      finalCallbackUrl += "/";
    }

    const url = `${baseUrl}/api/auth/callback/email?callbackUrl=${encodeURIComponent(finalCallbackUrl)}&token=${token}&email=${encodeURIComponent(email)}`;

    // Send the email using nodemailer (same as NextAuth)
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: Number(process.env.EMAIL_SERVER_PORT),
      auth: {
        user: process.env.EMAIL_SERVER_USER,
        pass: process.env.EMAIL_SERVER_PASSWORD,
      },
    });

    await transport.sendMail({
      to: email,
      from: process.env.EMAIL_FROM,
      subject: "Sign in to TestPlanIt",
      text: `Sign in to TestPlanIt\n\nClick the link below to sign in:\n${url}\n\nIf you did not request this email, you can safely ignore it.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Sign in to TestPlanIt</h2>
          <p>Click the button below to sign in:</p>
          <a href="${url}" style="display: inline-block; background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Sign In</a>
          <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
          <p style="color: #666; font-size: 14px; word-break: break-all;">${url}</p>
          <p style="color: #999; font-size: 12px; margin-top: 32px;">If you did not request this email, you can safely ignore it.</p>
        </div>
      `,
    });

    return NextResponse.json({
      success: true,
      message: "Magic link sent successfully",
    });
  } catch (error: any) {
    console.error("Failed to send magic link:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
    });

    return NextResponse.json(
      {
        error: "Failed to send magic link",
        details: error.message
      },
      { status: 500 }
    );
  }
}
