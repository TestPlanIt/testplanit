import { prisma } from "~/lib/prisma";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "~/server/auth";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Missing required query param: id" },
        { status: 400 }
      );
    }

    const config = await prisma.promptConfig.findUnique({
      where: { id },
      include: {
        prompts: {
          include: {
            llmIntegration: {
              select: { name: true },
            },
          },
        },
      },
    });

    if (!config) {
      return NextResponse.json(
        { error: "Prompt config not found" },
        { status: 404 }
      );
    }

    const exportPayload = {
      name: config.name,
      description: config.description,
      isDefault: config.isDefault,
      isActive: config.isActive,
      prompts: config.prompts.map((prompt) => ({
        feature: prompt.feature,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        temperature: prompt.temperature,
        maxOutputTokens: prompt.maxOutputTokens,
        llmIntegrationName: prompt.llmIntegration?.name ?? null,
        modelOverride: prompt.modelOverride ?? null,
      })),
    };

    return NextResponse.json(exportPayload, { status: 200 });
  } catch (error) {
    console.error("Error exporting prompt config:", error);
    return NextResponse.json(
      { error: "Failed to export prompt config" },
      { status: 500 }
    );
  }
}
