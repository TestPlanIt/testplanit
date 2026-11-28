import { NextResponse } from "next/server";
import { withRequestRouting } from "~/lib/db/requestRouting";
import { getPasskeyRelyingParty } from "~/lib/passkey";
import { getServerAuthSession } from "~/server/auth";

async function handleGET() {
  const session = await getServerAuthSession();

  // Only allow admins to check configuration status
  if (!session?.user || session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Passkeys are bound to the application's address, which browsers only
  // accept when it is served over HTTPS or on localhost.
  return NextResponse.json({ configured: getPasskeyRelyingParty().eligible });
}

export const GET = withRequestRouting(handleGET);
