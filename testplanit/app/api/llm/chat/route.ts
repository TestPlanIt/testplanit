import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { LlmManager } from "@/lib/llm/services/llm-manager.service";
import type { LlmRequest } from "@/lib/llm/types";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { llmIntegrationId, message, projectId, feature, model } = body;

    if (!llmIntegrationId || !message) {
      return NextResponse.json(
        { error: "LLM integration ID and message are required" },
        { status: 400 }
      );
    }

    // Check user has access to this project using centralized permission check
    const project = await prisma.projects.findUnique({
      where: { id: parseInt(projectId) },
    });

    if (!project) {
      return NextResponse.json(
        { error: "Project not found" },
        { status: 404 }
      );
    }

    // Use the same logic as the centralized permission API
    let hasAccess = false;

    // Check user-specific permissions first
    const userProjectPermission = await prisma.userProjectPermission.findUnique({
      where: {
        userId_projectId: {
          userId: session.user.id,
          projectId: parseInt(projectId),
        },
      },
    });

    if (userProjectPermission) {
      if (userProjectPermission.accessType !== "NO_ACCESS") {
        hasAccess = true;
      }
    } else if (project.defaultAccessType === "GLOBAL_ROLE" && session.user.access) {
      // Project uses global roles and user has a role
      hasAccess = true;
    } else if (project.defaultAccessType === "SPECIFIC_ROLE" && project.defaultRoleId) {
      // Project has a specific default role
      hasAccess = true;
    }

    // Admin always has access
    if (session.user.access === "ADMIN") {
      hasAccess = true;
    }

    if (!hasAccess) {
      return NextResponse.json(
        { error: "Access denied to this project" },
        { status: 403 }
      );
    }

    // Then verify the LLM integration exists for this project and get config
    const projectLlmIntegration = await prisma.projectLlmIntegration.findFirst({
      where: {
        llmIntegrationId: parseInt(llmIntegrationId),
        projectId: parseInt(projectId),
        isActive: true,
      },
      include: {
        llmIntegration: {
          include: {
            llmProviderConfig: true,
          },
        },
      },
    });

    if (!projectLlmIntegration) {
      return NextResponse.json(
        { error: "LLM integration not found for this project" },
        { status: 404 }
      );
    }

    const manager = LlmManager.getInstance(prisma);

    // Get the configured token limits from the LLM integration
    const llmProviderConfig = projectLlmIntegration.llmIntegration.llmProviderConfig;
    const maxTokens = llmProviderConfig?.defaultMaxTokens || 2048; // fallback to 2048 if not configured

    const llmRequest: LlmRequest = {
      messages: [
        {
          role: "system",
          content: "You are a helpful writing assistant. Provide clear, concise improvements to the text while maintaining the original intent and structure. Return the improved text using simple HTML formatting that works with rich text editors: use <p> tags for paragraphs, <strong> for bold text, <em> for italic text, <ul><li> for bullet points, <ol><li> for numbered lists, and <h1>, <h2>, <h3> for headings. Preserve the original structure and formatting. Do not include any commentary or explanations, only return the formatted improved text.",
        },
        {
          role: "user",
          content: message,
        },
      ],
      model,
      temperature: 0.3,
      maxTokens,
      stream: false,
      userId: session.user.id,
      projectId: parseInt(projectId),
      feature: feature || "editor-assistant",
      metadata: {
        source: "tiptap-editor",
        timestamp: new Date().toISOString(),
      },
    };

    const response = await manager.chat(parseInt(llmIntegrationId), llmRequest);

    return NextResponse.json({
      success: true,
      response,
    });
  } catch (error) {
    console.error("Error in LLM chat:", error);
    
    // Handle specific LLM errors with user-friendly messages
    let errorMessage = "Failed to process message";
    let statusCode = 500;
    
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Handle specific error types
      if ((error as any).code === 'CONTENT_BLOCKED' || (error as any).code === 'EMPTY_CONTENT' || (error as any).code === 'MAX_TOKENS') {
        statusCode = 400;
      }
    }
    
    return NextResponse.json({
      success: false,
      error: errorMessage,
    }, { status: statusCode });
  }
}