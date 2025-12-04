import type { PrismaClient, UserPreferences } from "@prisma/client";
import { compare } from "bcrypt";
import {
  getServerSession,
  type DefaultSession,
  type NextAuthOptions,
} from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import EmailProvider from "next-auth/providers/email";
import jwt from "jsonwebtoken";

import { db } from "~/server/db";
import { createCustomPrismaAdapter } from "./auth-adapter";
import { isEmailDomainAllowed } from "~/lib/utils/email-domain-validation";

/**
 * Helper function to generate Apple client secret from database config
 */
function generateAppleClientSecret(config: any): string | null {
  const privateKey = config.privateKey?.replace(/\\n/g, "\n");

  if (!privateKey || !config.keyId || !config.teamId || !config.clientId) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const expires = now + 86400 * 180; // 6 months

  const claims = {
    iss: config.teamId,
    iat: now,
    exp: expires,
    aud: "https://appleid.apple.com",
    sub: config.clientId,
  };

  try {
    return jwt.sign(claims, privateKey, {
      algorithm: "ES256",
      keyid: config.keyId,
    });
  } catch (error) {
    console.error("Failed to generate Apple client secret:", error);
    return null;
  }
}

/**
 * Helper function to generate Apple client secret from environment variables
 */
function getAppleClientSecret(): string | null {
  const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (
    !privateKey ||
    !process.env.APPLE_KEY_ID ||
    !process.env.APPLE_TEAM_ID ||
    !process.env.APPLE_CLIENT_ID
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const expires = now + 86400 * 180; // 6 months

  const claims = {
    iss: process.env.APPLE_TEAM_ID,
    iat: now,
    exp: expires,
    aud: "https://appleid.apple.com",
    sub: process.env.APPLE_CLIENT_ID,
  };

  try {
    return jwt.sign(claims, privateKey, {
      algorithm: "ES256",
      keyid: process.env.APPLE_KEY_ID,
    });
  } catch (error) {
    console.error("Failed to generate Apple client secret:", error);
    return null;
  }
}

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      name?: string | null;
      access?: "USER" | "PROJECTADMIN" | "ADMIN" | "NONE" | undefined | null;
      image?: string | null;
      emailVerified?: Date | null;
      authMethod?: "INTERNAL" | "SSO" | "BOTH" | null;
      preferences?: UserPreferences;
    } & DefaultSession["user"];
  }
}

/**
 * Module augmentation for `next-auth/jwt` types. Allows us to add custom properties to the JWT
 * token for middleware access control.
 */
declare module "next-auth/jwt" {
  interface JWT {
    access?: "USER" | "PROJECTADMIN" | "ADMIN" | "NONE" | null;
    provider?: string;
    isApi?: boolean;
  }
}

/**
 * Get dynamic providers from database
 */
async function getDynamicProviders() {
  const providers: any[] = [];

  try {
    // Get all enabled SSO providers from database
    const ssoProviders = await db.ssoProvider.findMany({
      where: { enabled: true },
      select: {
        type: true,
        config: true,
      },
    });

    for (const provider of ssoProviders) {
      if (provider.type === "GOOGLE" && provider.config) {
        const config = provider.config as any;
        if (config.clientId && config.clientSecret) {
          providers.push(
            GoogleProvider({
              clientId: config.clientId,
              clientSecret: config.clientSecret,
              authorization: {
                params: {
                  prompt: "consent",
                  access_type: "offline",
                  response_type: "code",
                },
              },
              allowDangerousEmailAccountLinking: true,
            })
          );
        }
      } else if (provider.type === "APPLE" && provider.config) {
        const config = provider.config as any;
        const clientSecret = generateAppleClientSecret(config);
        if (config.clientId && clientSecret) {
          providers.push(
            AppleProvider({
              clientId: config.clientId,
              clientSecret: clientSecret,
              authorization: {
                params: {
                  scope: "email name",
                  response_mode: "form_post",
                },
              },
              allowDangerousEmailAccountLinking: true,
              checks: [], // Disable all checks due to form_post cookie issues with proxy
            })
          );
        }
      } else if (provider.type === "MAGIC_LINK") {
        // Check if email server is configured
        if (
          process.env.EMAIL_SERVER_HOST &&
          process.env.EMAIL_SERVER_PORT &&
          process.env.EMAIL_SERVER_USER &&
          process.env.EMAIL_SERVER_PASSWORD &&
          process.env.EMAIL_FROM
        ) {
          providers.push(
            EmailProvider({
              server: {
                host: process.env.EMAIL_SERVER_HOST,
                port: Number(process.env.EMAIL_SERVER_PORT),
                auth: {
                  user: process.env.EMAIL_SERVER_USER,
                  pass: process.env.EMAIL_SERVER_PASSWORD,
                },
              },
              from: process.env.EMAIL_FROM,
              // Custom sendVerificationRequest that checks user existence
              sendVerificationRequest: async ({
                identifier: email,
                url,
                provider,
              }) => {
                // Wrap everything in try-catch to ensure we NEVER throw errors
                try {
                  // Check if user exists and is active
                  const user = await db.user
                    .findUnique({
                      where: { email },
                      select: { id: true, isActive: true },
                    })
                    .catch((err) => {
                      console.error("Database error checking user:", err);
                      return null;
                    });

                  // Only send email if user exists and is active
                  // This prevents email enumeration attacks
                  if (!user || !user.isActive) {
                    // Return successfully without sending email (prevents enumeration)
                    return Promise.resolve();
                  }

                  // Send the magic link email using nodemailer
                  const nodemailer = await import("nodemailer");
                  const transport = nodemailer.createTransport({
                    host: process.env.EMAIL_SERVER_HOST,
                    port: Number(process.env.EMAIL_SERVER_PORT),
                    auth: {
                      user: process.env.EMAIL_SERVER_USER,
                      pass: process.env.EMAIL_SERVER_PASSWORD,
                    },
                  });

                  await transport
                    .sendMail({
                      to: email,
                      from: process.env.EMAIL_FROM,
                      subject: "Sign in to TestPlanIt",
                      text: `Sign in to TestPlanIt\n\nClick the link below to sign in:\n${url}\n\nIf you did not request this email, you can safely ignore it.`,
                      html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <h2 style="color: #333;">Sign in to TestPlanIt</h2>
                        <p>Click the button below to sign in:</p>
                        <a href="${url}" style="display: inline-block; background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">Sign In</a>
                        <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
                        <p style="color: #666; font-size: 14px; word-break: break-all;">${url}</p>
                        <p style="color: #999; font-size: 12px; margin-top: 32px;">If you did not request this email, you can safely ignore it.</p>
                      </div>
                    `,
                    })
                    .catch((err) => {
                      console.error("Error sending magic link email:", err);
                      // Swallow error - we don't want to reveal if email was sent or not
                    });

                  return Promise.resolve();
                } catch (error) {
                  // Catch any errors and log them, but don't throw
                  // This ensures the UI always shows success (prevents enumeration)
                  console.error("Magic Link send error:", error);
                  // Return resolved promise to prevent error from propagating
                  return Promise.resolve();
                }
              },
            })
          );
        }
      }
    }
  } catch (error) {
    console.error("Failed to load dynamic providers:", error);
  }

  return providers;
}

/**
 * Get auth options dynamically
 */
export async function getAuthOptions(): Promise<NextAuthOptions> {
  const dynamicProviders = await getDynamicProviders();

  return {
    session: {
      strategy: "jwt",
    },
    pages: {
      signIn: "/signin",
      error: "/signin",
    },
    callbacks: {
      async session({ session, token }) {
        if (session.user) {
          session.user.id = token.sub!;
          session.user.name = token.name as string | undefined;

          // Fetch the user from the database to get the access level and preferences
          const user = await db.user.findUnique({
            where: { id: session.user.id },
            select: {
              access: true,
              image: true,
              emailVerified: true,
              authMethod: true,
              userPreferences: true,
              lastActiveAt: true,
            },
          });

          if (user) {
            session.user.access = user.access || undefined;
            session.user.image = user.image || undefined;
            session.user.emailVerified = user.emailVerified || undefined;
            session.user.authMethod = user.authMethod || undefined;

            // Create default userPreferences if they don't exist
            if (!user.userPreferences) {
              const newPreferences = await db.userPreferences.create({
                data: {
                  userId: session.user.id,
                },
              });
              session.user.preferences = newPreferences;
            } else {
              session.user.preferences = user.userPreferences;
            }

            // Update lastActiveAt only if it's been more than 5 minutes since the last update
            const now = new Date();
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

            if (!user.lastActiveAt || user.lastActiveAt < fiveMinutesAgo) {
              await db.user.update({
                where: { id: session.user.id },
                data: { lastActiveAt: now },
              });
            }
          }
        }
        return session;
      },
      async signIn({ user, account }) {
        // For OAuth/SSO sign-ins
        if (account?.provider !== "credentials") {
          // First check if user exists by email (not by ID, since ID might not exist yet)
          const dbUser = user.email
            ? await db.user.findUnique({
                where: { email: user.email },
                select: {
                  id: true,
                  authMethod: true,
                  isActive: true,
                  email: true,
                },
              })
            : null;

          // Prevent inactive users from signing in
          if (dbUser && !dbUser.isActive) {
            // Add delay for timing attack protection (make it look like we're processing)
            if (account?.provider === "email") {
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            return false;
          }

          // Magic Link (email provider) should ONLY allow existing users to sign in
          if (account?.provider === "email" && !dbUser) {
            // Add delay for timing attack protection
            await new Promise((resolve) => setTimeout(resolve, 3000));
            return false; // Reject sign-in if user doesn't exist
          }

          // For other OAuth providers (Google, Apple), if this is a new user, check domain restrictions
          if (!dbUser && user.email) {
            const isDomainAllowed = await isEmailDomainAllowed(user.email);
            if (!isDomainAllowed) {
              return false; // Reject sign-in if domain is not allowed
            }
          }

          if (dbUser) {
            // If user was INTERNAL, change to BOTH
            // If user was SSO, keep as SSO
            // If user was BOTH, keep as BOTH
            if (dbUser.authMethod === "INTERNAL") {
              await db.user.update({
                where: { id: dbUser.id },
                data: { authMethod: "BOTH" },
              });
            }
          }

          return true;
        }

        // For credentials provider, check by user ID
        const dbUser = await db.user.findUnique({
          where: { id: user.id },
          select: {
            authMethod: true,
            isActive: true,
            email: true,
          },
        });

        // Prevent inactive users from signing in
        if (dbUser && !dbUser.isActive) {
          return false;
        }

        // For credentials provider, always allow (already checked in authorize function)
        return true;
      },
      async jwt({ token, account, trigger }) {
        // Persist the OAuth account info in the token right after sign in
        if (account) {
          token.provider = account.provider;
        }

        // Fetch and store user access level and isApi flag in JWT for middleware access control
        // Fetch on sign in, explicit update, or if access is missing (for existing tokens)
        if (account || trigger === "update" || !token.access) {
          const user = await db.user.findUnique({
            where: { id: token.sub },
            select: { access: true, isApi: true },
          });
          if (user) {
            token.access = user.access;
            token.isApi = user.isApi;
          }
        }

        return token;
      },
    },
    adapter: createCustomPrismaAdapter(db),
    providers: [
      CredentialsProvider({
        credentials: {
          email: { type: "email" },
          password: { type: "password" },
        },
        authorize: authorize(db),
      }),
      // Dynamic providers from database
      ...dynamicProviders,
      // Fallback Google OAuth Provider from environment variables (for backward compatibility)
      // Only used if not configured in database
      ...(process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      !dynamicProviders.some((p) => p.id === "google")
        ? [
            GoogleProvider({
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
              authorization: {
                params: {
                  prompt: "consent",
                  access_type: "offline",
                  response_type: "code",
                },
              },
              allowDangerousEmailAccountLinking: true,
            }),
          ]
        : []),
      // Fallback Apple OAuth Provider from environment variables
      // Only used if not configured in database
      ...(process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY &&
      !dynamicProviders.some((p) => p.id === "apple")
        ? [
            AppleProvider({
              clientId: process.env.APPLE_CLIENT_ID,
              clientSecret: getAppleClientSecret() || "",
              authorization: {
                params: {
                  scope: "email name",
                  response_mode: "form_post",
                },
              },
              allowDangerousEmailAccountLinking: true,
              checks: [], // Disable all checks due to form_post cookie issues with proxy
            }),
          ]
        : []),
    ] as any[],
  };
}

/**
 * Static auth options for backward compatibility
 * This is deprecated and will be removed in future versions
 */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.name = token.name as string | undefined;

        // Fetch the user from the database to get the access level and preferences
        const user = await db.user.findUnique({
          where: { id: session.user.id },
          select: {
            access: true,
            image: true,
            emailVerified: true,
            authMethod: true,
            userPreferences: true,
            lastActiveAt: true,
          },
        });

        if (user) {
          session.user.access = user.access || undefined;
          session.user.image = user.image || undefined;
          session.user.emailVerified = user.emailVerified || undefined;
          session.user.authMethod = user.authMethod || undefined;

          // Create default userPreferences if they don't exist
          if (!user.userPreferences) {
            const newPreferences = await db.userPreferences.create({
              data: {
                userId: session.user.id,
              },
            });
            session.user.preferences = newPreferences;
          } else {
            session.user.preferences = user.userPreferences;
          }

          // Update lastActiveAt only if it's been more than 5 minutes since the last update
          const now = new Date();
          const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

          if (!user.lastActiveAt || user.lastActiveAt < fiveMinutesAgo) {
            await db.user.update({
              where: { id: session.user.id },
              data: { lastActiveAt: now },
            });
          }
        }
      }
      return session;
    },
    async signIn({ user, account }) {
      // For OAuth/SSO sign-ins
      if (account?.provider !== "credentials") {
        // First check if user exists by email (not by ID, since ID might not exist yet)
        const dbUser = user.email
          ? await db.user.findUnique({
              where: { email: user.email },
              select: {
                id: true,
                authMethod: true,
                isActive: true,
                email: true,
              },
            })
          : null;

        // Prevent inactive users from signing in
        if (dbUser && !dbUser.isActive) {
          // Add delay for timing attack protection (make it look like we're processing)
          if (account?.provider === "email") {
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
          return false;
        }

        // Magic Link (email provider) should ONLY allow existing users to sign in
        if (account?.provider === "email" && !dbUser) {
          // Add delay for timing attack protection
          await new Promise((resolve) => setTimeout(resolve, 3000));
          return false; // Reject sign-in if user doesn't exist
        }

        // For other OAuth providers (Google, Apple), if this is a new user, check domain restrictions
        if (!dbUser && user.email) {
          const isDomainAllowed = await isEmailDomainAllowed(user.email);
          if (!isDomainAllowed) {
            return false; // Reject sign-in if domain is not allowed
          }
        }

        if (dbUser) {
          // If user was INTERNAL, change to BOTH
          // If user was SSO, keep as SSO
          // If user was BOTH, keep as BOTH
          if (dbUser.authMethod === "INTERNAL") {
            await db.user.update({
              where: { id: dbUser.id },
              data: { authMethod: "BOTH" },
            });
          }
        }

        return true;
      }

      // For credentials provider, check by user ID
      const dbUser = await db.user.findUnique({
        where: { id: user.id },
        select: {
          authMethod: true,
          isActive: true,
          email: true,
        },
      });

      // Prevent inactive users from signing in
      if (dbUser && !dbUser.isActive) {
        return false;
      }

      // For credentials provider, always allow (already checked in authorize function)
      return true;
    },
    async jwt({ token, account, trigger }) {
      // Persist the OAuth account info in the token right after sign in
      if (account) {
        token.provider = account.provider;
      }

      // Fetch and store user access level and isApi flag in JWT for middleware access control
      // Fetch on sign in, explicit update, or if access is missing (for existing tokens)
      if (account || trigger === "update" || !token.access) {
        const user = await db.user.findUnique({
          where: { id: token.sub },
          select: { access: true, isApi: true },
        });
        if (user) {
          token.access = user.access;
          token.isApi = user.isApi;
        }
      }

      return token;
    },
  },
  adapter: createCustomPrismaAdapter(db),
  providers: [
    CredentialsProvider({
      credentials: {
        email: { type: "email" },
        password: { type: "password" },
      },
      authorize: authorize(db),
    }),
    // Fallback providers from environment variables
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                prompt: "consent",
                access_type: "offline",
                response_type: "code",
              },
            },
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
      ? [
          AppleProvider({
            clientId: process.env.APPLE_CLIENT_ID,
            clientSecret: getAppleClientSecret() || "",
            authorization: {
              params: {
                scope: "email name",
                response_mode: "form_post",
              },
            },
            allowDangerousEmailAccountLinking: true,
            checks: ["state"], // Disable PKCE for Apple Sign In with form_post
          }),
        ]
      : []),
  ] as any[],
};

function authorize(prisma: PrismaClient) {
  return async (
    credentials: Record<"email" | "password", string> | undefined
  ) => {
    if (!credentials) throw new Error("Missing credentials");
    if (!credentials.email)
      throw new Error('"email" is required in credentials');
    if (!credentials.password)
      throw new Error('"password" is required in credentials');
    const maybeUser = await prisma.user.findFirst({
      where: { email: credentials.email },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        isActive: true,
      },
    });
    if (!maybeUser?.password) return null;
    // Check if user is active
    if (!maybeUser.isActive) return null;
    // verify the input password with stored hash
    const isValid = await compare(credentials.password, maybeUser.password);
    if (!isValid) return null;
    return {
      id: maybeUser.id,
      email: maybeUser.email,
      name: maybeUser.name,
    };
  };
}

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = () => getServerSession(authOptions);
