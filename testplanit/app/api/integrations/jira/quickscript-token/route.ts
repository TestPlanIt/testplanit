import {
  authenticateForgeWrite,
  FORGE_CORS_HEADERS,
  mintForgeStreamToken,
} from "@/lib/services/forge-jira-auth";
import { NextRequest, NextResponse } from "next/server";
import { withRequestRouting } from "~/lib/db/requestRouting";

/**
 * Mint a short-lived token the panel uses to stream QuickScript generation
 * directly from the browser (bypassing Forge's 25s function limit).
 * Authenticated by the forge API key + forwarded Jira user, with project access
 * enforced. The token is bound to the resolved user/integration/project/issue,
 * so the streaming endpoint needs nothing else from the browser. Reuses the
 * same generic stream-token as the Generate Test Cases flow.
 */
async function handlePOST(request: NextRequest) {
  let body: { projectId?: number; issueKey?: string; issueId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const { projectId, issueKey, issueId } = body;
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required" },
      { status: 400, headers: FORGE_CORS_HEADERS }
    );
  }

  const auth = await authenticateForgeWrite(request, { projectId });
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: FORGE_CORS_HEADERS }
    );
  }

  const token = mintForgeStreamToken({
    userId: auth.user.id,
    integrationId: auth.integrationId,
    projectId,
    issueKey: issueKey ?? null,
    issueId: issueId ?? null,
  });

  return NextResponse.json({ token }, { headers: FORGE_CORS_HEADERS });
}

export const POST = withRequestRouting(handlePOST);

async function handleOPTIONS() {
  return new Response(null, { status: 200, headers: FORGE_CORS_HEADERS });
}

export const OPTIONS = withRequestRouting(handleOPTIONS);
