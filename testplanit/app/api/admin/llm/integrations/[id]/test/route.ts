import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    if (session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const resolvedParams = await params;
    const llmIntegrationId = parseInt(resolvedParams.id);
    const manager = LlmManager.getInstance(prisma);

    const isConnected = await manager.testConnection(llmIntegrationId);

    return NextResponse.json({
      success: isConnected,
      error: isConnected ? null : "Failed to connect to the provider",
    });
  } catch (error) {
    console.error("Error testing LLM integration:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to test connection";
    return NextResponse.json({
      success: false,
      error: errorMessage,
    });
  }
}