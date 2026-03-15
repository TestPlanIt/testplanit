import { prisma as db } from "@/lib/prisma";
import { IntegrationProvider } from "@prisma/client";
import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

function constantTimeCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Forge-Api-Key",
};

export async function GET(request: NextRequest) {
  try {
    const forgeApiKey = request.headers.get("X-Forge-Api-Key");

    if (!forgeApiKey) {
      return NextResponse.json(
        { error: "Missing API key" },
        { status: 401, headers }
      );
    }

    const jiraIntegrations = await db.integration.findMany({
      where: {
        provider: IntegrationProvider.JIRA,
        isDeleted: false,
      },
      select: {
        id: true,
        settings: true,
      },
    });

    const authenticatedIntegration = jiraIntegrations.find((integration) => {
      const settings = integration.settings as Record<string, unknown> | null;
      const storedKey = settings?.forgeApiKey as string | undefined;
      if (!storedKey || !forgeApiKey) return false;
      return constantTimeCompare(storedKey, forgeApiKey);
    });

    if (!authenticatedIntegration) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401, headers }
      );
    }

    return NextResponse.json(
      { success: true },
      { headers }
    );
  } catch (error) {
    console.error("Error in test-connection:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers,
  });
}
