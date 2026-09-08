"use server";

import { baseDb } from "~/lib/db";

export async function verifyEmail(email: any, token: any) {
  if (!email || !token) {
    return new Error("Missing email or token");
  }
  try {
    const user = await baseDb.user.findFirstOrThrow({
      where: {
        email: { equals: email, mode: "insensitive" },
        emailVerifToken: token,
        emailTokenExpires: {
          gte: new Date(),
        },
      },
    });
    return await baseDb.user.update({
      where: { id: user.id, emailVerifToken: token },
      data: {
        emailVerified: new Date(),
        emailVerifToken: null,
      },
    });
  } catch (e: any) {
    return `Error verifying email ${email}: ${e.message}`;
  }
}
