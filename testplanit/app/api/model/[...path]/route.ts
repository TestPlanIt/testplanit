import { enhance } from "@zenstackhq/runtime";
import { NextRequestHandler } from "@zenstackhq/server/next";
import { getServerAuthSession } from "~/server/auth";
import { db } from "~/server/db";
import { prisma } from "~/lib/prisma";

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
        isActive: true,
        isDeleted: true,
        role: {
          include: {
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

const handler = NextRequestHandler({ getPrisma, useAppDir: true });

export {
  handler as DELETE,
  handler as GET,
  handler as PATCH,
  handler as POST,
  handler as PUT,
};
