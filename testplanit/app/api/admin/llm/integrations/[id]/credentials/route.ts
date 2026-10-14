import { baseDb } from "@/lib/db";
import { loadLlmCredentials } from "@/lib/llm/credentials";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

/**
 * What the edit dialog may show of an AI model's credentials: its endpoint
 * and whether a key is set. The key itself never leaves the server.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.access !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const llmIntegrationId = Number((await params).id);
  if (!Number.isInteger(llmIntegrationId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const credentials = await loadLlmCredentials(
      baseDb as never,
      llmIntegrationId
    );
    if (!credentials) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      endpoint: credentials.endpoint ?? credentials.baseUrl ?? null,
      hasApiKey: Boolean(credentials.apiKey),
    });
  } catch (error) {
    console.error("Error reading AI model credentials:", error);
    return NextResponse.json(
      { error: "The stored credentials could not be read" },
      { status: 500 }
    );
  }
}
