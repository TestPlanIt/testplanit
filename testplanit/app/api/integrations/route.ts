import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/utils/encryption";

export async function GET(request: NextRequest) {
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

    const integrations = await prisma.integration.findMany({
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
}

export async function POST(request: NextRequest) {
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
    const { name, type, authType, config } = body;

    if (!name || !type || !config) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Check if name already exists
    const existing = await prisma.integration.findFirst({
      where: {
        name,
        isDeleted: false,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "An integration with this name already exists" },
        { status: 400 }
      );
    }

    // Encrypt config data
    const configString = JSON.stringify(config);
    const encryptedConfig = await encrypt(configString);

    const integration = await prisma.integration.create({
      data: {
        name,
        provider: type,
        authType,
        credentials: { encrypted: encryptedConfig },
        status: "ACTIVE",
      },
    });

    return NextResponse.json(integration, { status: 201 });
  } catch (error) {
    console.error("Error creating integration:", error);
    return NextResponse.json(
      { error: "Failed to create integration" },
      { status: 500 }
    );
  }
}
