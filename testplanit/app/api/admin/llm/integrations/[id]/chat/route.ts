import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import type { LlmRequest } from "@/lib/llm/types";

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
    const body = await request.json();
    const { message, model } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const manager = LlmManager.getInstance(prisma);

    const llmRequest: LlmRequest = {
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant for testing LLM integrations. Keep your responses brief.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      model,
      temperature: 0.7,
      maxTokens: 500,
      stream: false,
      userId: session.user.id,
      feature: "admin-test",
      metadata: {
        source: "admin-panel",
        timestamp: new Date().toISOString(),
      },
    };

    const response = await manager.chat(llmIntegrationId, llmRequest);

    // Get the usage for this request
    const usage = await prisma.llmUsage.findFirst({
      where: {
        llmIntegrationId,
        userId: session.user.id,
        feature: "admin-test",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      success: true,
      response,
      usage: usage ? {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        inputCost: Number(usage.inputCost),
        outputCost: Number(usage.outputCost),
        totalCost: Number(usage.totalCost),
      } : null,
    });
  } catch (error) {
    console.error("Error in admin chat test:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process message";
    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: 500 });
  }
}