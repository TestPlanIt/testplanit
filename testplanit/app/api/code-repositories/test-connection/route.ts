import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { createGitRepoAdapter } from "~/lib/integrations/adapters/GitRepoAdapter";
import { authOptions } from "~/server/auth";
import { isSsrfSafe } from "~/utils/ssrf";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (user?.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { repositoryId, provider, credentials, settings } = body;

    let resolvedCredentials = credentials;
    let resolvedSettings = settings;
    let resolvedProvider = provider;

    // If repositoryId provided, load from DB
    if (repositoryId && !credentials) {
      const repo = await prisma.codeRepository.findUnique({
        where: { id: parseInt(repositoryId) },
        select: { credentials: true, settings: true, provider: true },
      });
      if (!repo) {
        return NextResponse.json(
          { error: "Repository not found" },
          { status: 404 }
        );
      }
      resolvedCredentials = repo.credentials as Record<string, string>;
      resolvedSettings = repo.settings;
      resolvedProvider = repo.provider;
    }

    if (!resolvedProvider) {
      return NextResponse.json(
        { success: false, error: "Provider not specified" },
        { status: 400 }
      );
    }

    if (!resolvedCredentials) {
      return NextResponse.json(
        { success: false, error: "Credentials not provided" },
        { status: 400 }
      );
    }

    // SSRF validation for providers with user-supplied base URLs
    if (resolvedSettings?.baseUrl && !isSsrfSafe(resolvedSettings.baseUrl)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid base URL: private/loopback addresses are not allowed",
        },
        { status: 400 }
      );
    }
    if (
      resolvedSettings?.organizationUrl &&
      !isSsrfSafe(resolvedSettings.organizationUrl)
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid organization URL: private/loopback addresses are not allowed",
        },
        { status: 400 }
      );
    }

    const adapter = createGitRepoAdapter(
      resolvedProvider,
      resolvedCredentials,
      resolvedSettings
    );

    const result = await adapter.testConnection();

    // If repositoryId provided, update lastTestedAt and status in DB
    if (repositoryId) {
      if (result.success) {
        await prisma.codeRepository.update({
          where: { id: parseInt(repositoryId) },
          data: {
            lastTestedAt: new Date(),
            status: "ACTIVE",
          },
        });
      } else {
        await prisma.codeRepository.update({
          where: { id: parseInt(repositoryId) },
          data: { status: "ERROR" },
        });
      }
    }

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[POST /api/code-repositories/test-connection]:", err);
    return NextResponse.json(
      { success: false, error: err.message ?? "Test connection failed" },
      { status: 500 }
    );
  }
}
