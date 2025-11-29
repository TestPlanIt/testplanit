import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/utils/encryption";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (user?.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const integration = await prisma.integration.findUnique({
      where: {
        id: parseInt(id),
        isDeleted: false,
      },
      include: {
        userIntegrationAuths: {
          where: { isActive: true },
          select: {
            id: true,
            userId: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            lastUsedAt: true,
          },
        },
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    // Decrypt credentials for admin viewing
    if (
      integration.credentials &&
      typeof integration.credentials === "object" &&
      "encrypted" in integration.credentials
    ) {
      const decrypted = await decrypt(
        integration.credentials.encrypted as string
      );
      integration.credentials = JSON.parse(decrypted);
    }

    return NextResponse.json(integration);
  } catch (error) {
    console.error("Error fetching integration:", error);
    return NextResponse.json(
      { error: "Failed to fetch integration" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (user?.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, authType, status, settings, credentials } = body;

    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (authType !== undefined) updateData.authType = authType;
    if (status !== undefined) updateData.status = status;
    if (settings !== undefined) updateData.settings = settings;

    // Encrypt credentials if provided
    if (credentials !== undefined) {
      const credentialsString = JSON.stringify(credentials);
      const encryptedCredentials = await encrypt(credentialsString);
      updateData.credentials = { encrypted: encryptedCredentials };
    }

    const { id } = await params;
    const integration = await prisma.integration.update({
      where: {
        id: parseInt(id),
        isDeleted: false,
      },
      data: updateData,
    });

    return NextResponse.json(integration);
  } catch (error) {
    console.error("Error updating integration:", error);
    return NextResponse.json(
      { error: "Failed to update integration" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { access: true },
    });

    if (user?.access !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if integration has active connections
    const { id } = await params;
    const integration = await prisma.integration.findUnique({
      where: {
        id: parseInt(id),
        isDeleted: false,
      },
      include: {
        _count: {
          select: {
            projectIntegrations: true,
          },
        },
      },
    });

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 }
      );
    }

    if (integration._count.projectIntegrations > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete integration with active project integrations",
        },
        { status: 400 }
      );
    }

    // Soft delete
    await prisma.integration.update({
      where: { id: parseInt(id) },
      data: { isDeleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting integration:", error);
    return NextResponse.json(
      { error: "Failed to delete integration" },
      { status: 500 }
    );
  }
}
