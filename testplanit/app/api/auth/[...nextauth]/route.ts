import NextAuth from "next-auth";
import { cookies } from "next/headers";
import { getAuthOptions } from "~/server/auth";

/**
 * Clear existing session cookies to prevent conflicts when signing in
 * This solves the issue where clicking a magic link in a browser with
 * an existing session doesn't work properly.
 */
async function clearSessionCookies() {
  const cookieStore = await cookies();

  // NextAuth session cookie names (both secure and non-secure variants)
  const sessionCookieNames = [
    "next-auth.session-token",
    "__Secure-next-auth.session-token",
  ];

  for (const cookieName of sessionCookieNames) {
    try {
      cookieStore.delete(cookieName);
    } catch {
      // Cookie might not exist, that's fine
    }
  }
}

// Create handlers dynamically to load providers from database
// Note: In Next.js 15+, params is a Promise that must be awaited
export async function GET(
  req: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const url = new URL(req.url);

  // Check if this is an email callback (magic link)
  // Clear existing session to prevent conflicts with the new sign-in
  if (
    url.pathname.includes("/callback/email") ||
    (url.pathname.includes("/callback") && url.searchParams.has("token"))
  ) {
    await clearSessionCookies();
  }

  const authOptions = await getAuthOptions();
  const handler = NextAuth(authOptions);

  // Await params before passing to NextAuth (Next.js 15+ requirement)
  const resolvedContext = {
    params: await context.params,
  };

  return handler(req, resolvedContext);
}

export async function POST(
  req: Request,
  context: { params: Promise<{ nextauth: string[] }> }
) {
  const authOptions = await getAuthOptions();
  const handler = NextAuth(authOptions);

  // Await params before passing to NextAuth (Next.js 15+ requirement)
  const resolvedContext = {
    params: await context.params,
  };

  return handler(req, resolvedContext);
}
