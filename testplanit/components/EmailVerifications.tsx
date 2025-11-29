"use server";

import { db } from "~/server/db";
import nodemailer from "nodemailer";
import { randomBytes } from "crypto";

export const generateEmailVerificationToken = async () => {
  return randomBytes(32).toString("hex");
};

export const sendVerificationEmail = async (email: string, token: string) => {
  const transporter: nodemailer.Transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port: Number(process.env.EMAIL_SERVER_PORT) || 0,
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`,
  });

  const emailData = {
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`,
    to: email,
    subject: "TestPlanIt Email Verification",
    html: `
      <div>Click the link below to verify your email:</div>
      <a href="${process.env.NEXTAUTH_URL}/verify-email?email=${encodeURIComponent(email)}&token=${token}">Verify Email</a>
      <div>This link will expire in 24 hours.</div>
    `,
  };

  try {
    await transporter.sendMail(emailData);
  } catch (error) {
    console.error("Failed to send email:", error);
    throw error;
  }
};

export const resendVerificationEmail = async (email: string) => {
  const emailVerificationToken = await generateEmailVerificationToken(); // Await the async function

  try {
    await db.user.findFirstOrThrow({
      where: {
        email: email,
        emailVerified: null,
      },
    });
    await db.user.update({
      where: { email },
      data: {
        emailVerifToken: await emailVerificationToken,
        emailTokenExpires: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24 hours
      },
    });

    await sendVerificationEmail(email, await emailVerificationToken);
  } catch (error) {
    return false;
  }
  return true;
};
