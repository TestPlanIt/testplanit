import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { encode } from "next-auth/jwt";
import { db } from "~/server/db";

// SAML completion handler - creates NextAuth session
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get("token");
    const callbackUrl = searchParams.get("callbackUrl") || "/";

    if (!token) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    // Verify the JWT token
    let tokenData: any;
    try {
      tokenData = jwt.verify(
        token,
        process.env.NEXTAUTH_SECRET || "development-secret"
      );
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Get user from database
    const user = await db.user.findUnique({
      where: { id: tokenData.userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Create NextAuth JWT session token
    const sessionToken = await encode({
      token: {
        sub: user.id,
        email: user.email,
        name: user.name,
        provider: tokenData.provider,
      },
      secret: process.env.NEXTAUTH_SECRET || "development-secret",
    });

    // Set the session cookie
    const cookieStore = await cookies();
    cookieStore.set("next-auth.session-token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    // For production, use secure cookie name
    if (process.env.NODE_ENV === "production") {
      cookieStore.set("__Secure-next-auth.session-token", sessionToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    }

    // Redirect to callback URL
    return NextResponse.redirect(new URL(callbackUrl, request.url));
  } catch (error) {
    console.error("SAML completion error:", error);
    return NextResponse.json(
      { error: "Failed to complete SAML authentication" },
      { status: 500 }
    );
  }
}
