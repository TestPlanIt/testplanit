"use server";

import { baseDb } from "~/lib/db";

export async function verifyEmail(email: any, token: any) {
  if (!email || !token) {
    return new Error("Missing email or token");
  }
  try {
    await baseDb.user.findFirstOrThrow({
      where: {
        email: email,
        emailVerifToken: token,
        emailTokenExpires: {
          gte: new Date(),
        },
      },
    });
    return await baseDb.user.update({
      where: { emailVerifToken: token, email: email },
      data: {
        emailVerified: new Date(),
        emailVerifToken: null,
      },
    });
  } catch (e: any) {
    return `Error verifying email ${email}: ${e.message}`;
  }
}
