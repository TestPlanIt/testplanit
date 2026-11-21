import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "~/server/auth";
import { QaseApiError } from "~/services/imports/qase/qaseClient";

export async function requireAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.access !== "ADMIN") {
    return null;
  }
  return session;
}

export const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

/** A Qase failure the admin can act on, with a code the UI translates. */
export function qaseErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof QaseApiError)) {
    return null;
  }
  const status =
    error.code === "invalid_host" || error.code === "unauthorized" ? 400 : 502;
  return NextResponse.json(
    { error: error.message, code: error.code },
    { status }
  );
}

export function readConnection(body: unknown): {
  token: string;
  host: string | undefined;
} | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const { token, host } = body as { token?: unknown; host?: unknown };
  if (typeof token !== "string" || !token.trim()) {
    return null;
  }
  return {
    token: token.trim(),
    host: typeof host === "string" && host.trim() ? host.trim() : undefined,
  };
}
