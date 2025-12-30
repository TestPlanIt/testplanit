import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { llmIntegrationId } = body as { llmIntegrationId?: number };

    const manager = LlmManager.getInstance(prisma);

    if (llmIntegrationId) {
      // Clear cache for specific integration
      manager.clearCache(llmIntegrationId);
    } else {
      // Clear all cached adapters
      manager.clearCache();
    }

    return NextResponse.json({
      success: true,
      message: llmIntegrationId
        ? `Cache cleared for integration ${llmIntegrationId}`
        : "All LLM adapter caches cleared",
    });
  } catch (error) {
    console.error("Error clearing LLM cache:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to clear cache";

    return NextResponse.json(
      { error: "Failed to clear cache", details: errorMessage },
      { status: 500 }
    );
  }
}
