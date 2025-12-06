import { enhance } from "@zenstackhq/runtime";
import { NextRequestHandler } from "@zenstackhq/server/next";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { prisma } from "~/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

async function getPrisma() {
  const session = await getServerAuthSession();
  const userId = session?.user?.id;

  let user;
  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        access: true,
        roleId: true, // Required by ZenStack authSelector
        isActive: true,
        isDeleted: true,
        role: {
          select: {
            id: true,
            rolePermissions: true,
          },
        },
        groups: {
          include: {
            group: true,
          },
        },
      },
    });
  }

  return enhance(db, { user: user ?? undefined });
}

const baseHandler = NextRequestHandler({ getPrisma, useAppDir: true });

// Wrapper to add cache-control headers to prevent browser caching of API responses
async function handler(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const response = await baseHandler(req, context);

  // Clone the response to add headers (NextResponse is immutable)
  const newResponse = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  // Prevent caching of API responses - this is critical to avoid stale 410/error responses
  newResponse.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  newResponse.headers.set("Pragma", "no-cache");
  newResponse.headers.set("Expires", "0");

  return newResponse;
}

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
