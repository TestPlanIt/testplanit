import { baseDb } from "@/lib/db";
import { encrypt } from "@/utils/encryption";
import { IntegrationStatus } from "~/zenstack/models";
import { getServerSession } from "next-auth/next";
import { NextRequest, NextResponse } from "next/server";
import { withAuditContext } from "~/lib/auditContextWrappers";
import { authOptions } from "~/server/auth";

export const GET = withAuditContext(async (_request: NextRequest) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await baseDb.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (user?.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const integrations = await baseDb.integration.findMany({
      where: { isDeleted: false },
      select: {
        id: true,
        name: true,
        provider: true,
        authType: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            projectIntegrations: true,
          },
        },
      },
    });

    return NextResponse.json(integrations);
  } catch (error) {
    console.error("Error fetching integrations:", error);
    return NextResponse.json(
      { error: "Failed to fetch integrations" },
      { status: 500 }
    );
  }
});

export const POST = withAuditContext(async (request: NextRequest) => {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await baseDb.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (user?.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, authType, config, settings, status } = body;

    if (!name || !type || !config) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Reject only if an ACTIVE row already exists with this name. A
    // soft-deleted row gets resurrected by the upsert below — without
    // that path, a plain create against a soft-deleted name 23505s and
    // the admin gets a confusing "this exists but I can't find it"
    // error. (Same latent bug pattern fix as LlmIntegration, Issue,
    // RepositoryCases, TestCaseParameter — see PR description.)
    const existingActive = await baseDb.integration.findFirst({
      where: { name, isDeleted: false },
    });
    if (existingActive) {
      return NextResponse.json(
        { error: "An integration with this name already exists" },
        { status: 400 }
      );
    }

    // Encrypt config data
    const configString = JSON.stringify(config);
    const encryptedConfig = await encrypt(configString);

    const integrationFields = {
      provider: type,
      authType,
      credentials: { encrypted: encryptedConfig },
      // Provider-specific settings (baseUrl and friends) are not secrets and
      // are stored in the clear, but they are required for the adapter to
      // reach the instance at all — dropping them here left every new
      // integration unable to build a request.
      ...(settings !== undefined ? { settings } : {}),
      // An integration is only ACTIVE once something has vouched for it: a
      // passing connection test on create, or a completed OAuth handshake.
      // Defaulting to ACTIVE marked OAuth2 rows connected before any token
      // existed.
      status: (status as IntegrationStatus) ?? IntegrationStatus.INACTIVE,
    };
    const integration = await baseDb.integration.upsert({
      where: { name },
      create: { name, ...integrationFields },
      update: { ...integrationFields, isDeleted: false },
    });

    return NextResponse.json(integration, { status: 201 });
  } catch (error) {
    console.error("Error creating integration:", error);
    return NextResponse.json(
      { error: "Failed to create integration" },
      { status: 500 }
    );
  }
});
