import nodemailer from "nodemailer";
import { renderEmailTemplate } from "./template-service";

interface NotificationEmailData {
  to: string;
  userId: string;
  userName: string;
  notificationTitle: string;
  notificationMessage: string;
  notificationUrl?: string;
  locale?: string;
  translations?: Record<string, string>;
  htmlMessage?: string;
}

interface DigestEmailData {
  to: string;
  userId: string;
  userName: string;
  notifications: Array<{
    id: string;
    title: string;
    message: string;
    createdAt: Date;
    url?: string;
  }>;
  locale?: string;
  translations?: Record<string, string>;
}

const getTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port: Number(process.env.EMAIL_SERVER_PORT) || 0,
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`,
  });
};

export async function sendNotificationEmail(data: NotificationEmailData) {
  const transporter = getTransporter();
  
  // Render the email using Handlebars template
  const { html, subject } = await renderEmailTemplate('notification', {
    userName: data.userName,
    notification: {
      title: data.notificationTitle,
      message: data.notificationMessage,
      htmlMessage: data.htmlMessage,
      createdAt: new Date(),
    },
    notificationUrl: data.notificationUrl,
    appUrl: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    locale: data.locale || 'en-US',
    userId: data.userId,
    currentYear: new Date().getFullYear(),
    subject: `TestPlanIt: ${data.notificationTitle}`,
    translations: data.translations || {},
  });

  const emailData = {
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`,
    to: data.to,
    subject,
    html,
  };

  try {
    await transporter.sendMail(emailData);
  } catch (error) {
    console.error("Failed to send notification email:", error);
    throw error;
  }
}

export async function sendDigestEmail(data: DigestEmailData) {
  const transporter = getTransporter();
  
  // Render the email using Handlebars template
  const { html, subject } = await renderEmailTemplate('daily-digest', {
    userName: data.userName,
    notifications: data.notifications,
    appUrl: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    locale: data.locale || 'en-US',
    userId: data.userId,
    currentYear: new Date().getFullYear(),
    subject: `TestPlanIt Daily Digest - ${data.notifications.length} notifications`,
    translations: data.translations || {},
  });

  const emailData = {
    from: `"TestPlanIt" <${process.env.EMAIL_FROM}>`,
    to: data.to,
    subject,
    html,
  };

  try {
    await transporter.sendMail(emailData);
  } catch (error) {
    console.error("Failed to send digest email:", error);
    throw error;
  }
}