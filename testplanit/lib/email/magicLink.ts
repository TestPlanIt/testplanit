import nodemailer from "nodemailer";

import {
  getServerTranslation,
  getServerTranslations,
} from "../server-translations";

interface SendMagicLinkEmailArgs {
  /** Recipient email address. */
  to: string;
  /** Pre-built sign-in URL with the verification token. */
  url: string;
  /** Recipient's locale (`en_US` / `es_ES` / `fr_FR`). Falls back to en_US. */
  locale?: string | null;
  /** Override the From: address. Defaults to `process.env.EMAIL_FROM`. */
  from?: string;
}

const PURPLE = "#7c3aed";

/**
 * Send a localized magic-link sign-in email.
 *
 * Both NextAuth's email provider hook (server/auth.ts) and the
 * trial-admin provisioning route (app/api/auth/send-magic-link/route.ts)
 * call this helper so the rendered email subject/body is consistent and
 * stays in lock-step with the recipient's locale.
 *
 * Errors from the SMTP transport are intentionally NOT propagated —
 * surfacing them to the caller would let an attacker probe whether a
 * user exists by triggering different code paths. The caller is
 * expected to look up the user before invoking this helper.
 */
export async function sendMagicLinkEmail(
  args: SendMagicLinkEmailArgs
): Promise<void> {
  const userLocale = args.locale || "en_US";

  // Pull every key in one batched call to avoid N round-trips through
  // the JSON loader. `getServerTranslations` falls back to en-US per
  // key when the requested locale has no entry.
  const t = await getServerTranslations(userLocale, [
    "email.magicLink.subject",
    "email.magicLink.heading",
    "email.magicLink.intro",
    "email.magicLink.signInButton",
    "email.magicLink.copyPasteIntro",
    "email.magicLink.disclaimer",
    "email.magicLink.textBody",
  ]);

  const text = await getServerTranslation(
    userLocale,
    "email.magicLink.textBody",
    { url: args.url }
  );

  const transport = nodemailer.createTransport({
    host: process.env.EMAIL_SERVER_HOST,
    port: Number(process.env.EMAIL_SERVER_PORT),
    auth: {
      user: process.env.EMAIL_SERVER_USER,
      pass: process.env.EMAIL_SERVER_PASSWORD,
    },
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">${t["email.magicLink.heading"]}</h2>
      <p>${t["email.magicLink.intro"]}</p>
      <a href="${args.url}" style="display: inline-block; background-color: ${PURPLE}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">${t["email.magicLink.signInButton"]}</a>
      <p style="color: #666; font-size: 14px;">${t["email.magicLink.copyPasteIntro"]}</p>
      <p style="color: #666; font-size: 14px; word-break: break-all;">${args.url}</p>
      <p style="color: #999; font-size: 12px; margin-top: 32px;">${t["email.magicLink.disclaimer"]}</p>
    </div>
  `;

  await transport.sendMail({
    to: args.to,
    from: args.from ?? process.env.EMAIL_FROM,
    subject: t["email.magicLink.subject"],
    text,
    html,
  });
}
