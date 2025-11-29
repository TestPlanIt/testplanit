"use server";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export async function verifyEmail(email: any, token: any) {
  if (!email || !token) {
    return new Error("Missing email or token");
  }
  try {
    await prisma.user.findFirstOrThrow({
      where: {
        email: email,
        emailVerifToken: token,
        emailTokenExpires: {
          gte: new Date(),
        },
      },
    });
    return await prisma.user.update({
      where: { emailVerifToken: token, email: email },
      data: {
        emailVerified: new Date().toISOString(),
        emailVerifToken: null,
      },
    });
  } catch (e: any) {
    return `Error verifying email ${email}: ${e.message}`;
  }
}
