import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import type { LlmRequest } from "@/lib/llm/types";

/**
 * Test endpoint for LLM integration
 * GET /api/llm/test - Lists available integrations
 * POST /api/llm/test - Tests an LLM integration
 */

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const manager = LlmManager.getInstance(prisma);

    // List available integrations
    const integrations = await manager.listAvailableIntegrations();

    // Test connections for each integration
    const integrationsWithStatus = await Promise.all(
      integrations.map(async (integration) => {
        const isConnected = await manager.testConnection(integration.id);
        let models: any[] = [];

        if (isConnected) {
          try {
            models = await manager.getAvailableModels(integration.id);
          } catch (error) {
            console.error(
              `Failed to fetch models for ${integration.name}:`,
              error
            );
          }
        }

        return {
          ...integration,
          isConnected,
          models: models.map((m) => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
          })),
        };
      })
    );

    return NextResponse.json({
      success: true,
      integrations: integrationsWithStatus,
      defaultIntegrationId: await manager.getDefaultIntegration(),
    });
  } catch (error) {
    console.error("Error in GET /api/llm/test:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      integrationId,
      message = "Hello! Can you respond with a brief greeting?",
      stream = false,
      model,
    } = body;

    if (!integrationId) {
      return NextResponse.json(
        { error: "integrationId is required" },
        { status: 400 }
      );
    }

    const manager = LlmManager.getInstance(prisma);

    // Check if user has access to this integration
    const integration = await prisma.llmIntegration.findFirst({
      where: {
        id: integrationId,
        isDeleted: false,
        status: "ACTIVE",
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found or access denied" },
        { status: 404 }
      );
    }

    const llmRequest: LlmRequest = {
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Keep your responses brief and friendly.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      model,
      temperature: 0.7,
      maxTokens: 200,
      stream,
      userId: session.user.id,
      feature: "test",
      metadata: {
        endpoint: "test",
        timestamp: new Date().toISOString(),
      },
    };

    // Testing LLM integration

    if (stream) {
      // For streaming, we need to return a streaming response
      const encoder = new TextEncoder();
      const streamResponse = new ReadableStream({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(`data: {"type": "start"}\n\n`));

            let fullContent = "";
            for await (const chunk of manager.chatStream(
              integrationId,
              llmRequest
            )) {
              fullContent += chunk.delta;
              const data = JSON.stringify({
                type: "chunk",
                content: chunk.delta,
                model: chunk.model,
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            }

            const finalData = JSON.stringify({
              type: "complete",
              fullContent,
            });
            controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : "Stream error";
            const errorData = JSON.stringify({
              type: "error",
              error: errorMessage,
            });
            controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
            controller.close();
          }
        },
      });

      return new Response(streamResponse, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      // Non-streaming response
      const response = await manager.chat(integrationId, llmRequest);

      // Get usage stats for this test
      const usage = await prisma.llmUsage.findFirst({
        where: {
          llmIntegrationId: integrationId,
          userId: session.user.id,
          feature: "test",
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return NextResponse.json({
        success: true,
        request: {
          message,
          model: model || "default",
          integrationId,
        },
        response: {
          content: response.content,
          model: response.model,
          tokens: {
            prompt: response.promptTokens,
            completion: response.completionTokens,
            total: response.totalTokens,
          },
          finishReason: response.finishReason,
        },
        usage: usage
          ? {
              cost: {
                input: usage.inputCost,
                output: usage.outputCost,
                total: usage.totalCost,
              },
              timestamp: usage.createdAt,
            }
          : null,
      });
    }
  } catch (error) {
    console.error("Error in POST /api/llm/test:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to process LLM request";
    const errorCode =
      error instanceof Error && "code" in error
        ? (error as any).code
        : undefined;
    return NextResponse.json(
      {
        error: "Failed to process LLM request",
        details: errorMessage,
        code: errorCode,
      },
      { status: 500 }
    );
  }
}
