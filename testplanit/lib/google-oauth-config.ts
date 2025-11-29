import { db } from "~/server/db";
import { SsoProviderType } from "@prisma/client";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Loads Google OAuth configuration from the database
 * Returns null if Google OAuth is not configured or disabled
 */
export async function getGoogleOAuthConfig(): Promise<GoogleOAuthConfig | null> {
  try {
    const googleProvider = await db.ssoProvider.findFirst({
      where: {
        type: SsoProviderType.GOOGLE,
        enabled: true,
      },
      select: {
        config: true,
      },
    });

    if (!googleProvider?.config) {
      return null;
    }

    const config = googleProvider.config as any;
    
    // Validate that both clientId and clientSecret exist
    if (!config.clientId || !config.clientSecret) {
      return null;
    }

    return {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    };
  } catch (error) {
    console.error("Failed to load Google OAuth config from database:", error);
    return null;
  }
}

