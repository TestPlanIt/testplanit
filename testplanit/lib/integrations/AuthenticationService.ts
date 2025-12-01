import { prisma } from "@/lib/prismaBase";
import { EncryptionService, getMasterKey } from "@/utils/encryption";
import crypto from "crypto";

/**
 * Service for handling integration authentication flows
 */
export class AuthenticationService {
  /**
   * Generate a secure state parameter for OAuth flows
   */
  static generateState(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Store OAuth state for verification
   */
  static async storeOAuthState(
    userId: string,
    integrationId: number,
    state: string,
    expiresIn: number = 600 // 10 minutes
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Store state in a temporary storage (could be Valkey in production)
    // For now, we'll use the integration's settings field
    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        settings: {
          ...(((
            await prisma.integration.findUnique({
              where: { id: integrationId },
              select: { settings: true },
            })
          )?.settings as object) || {}),
          oauthState: {
            [state]: {
              userId,
              expiresAt: expiresAt.toISOString(),
            },
          },
        },
      },
    });
  }

  /**
   * Verify OAuth state parameter
   */
  static async verifyOAuthState(
    integrationId: number,
    state: string
  ): Promise<{ valid: boolean; userId?: string }> {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { settings: true },
    });

    const settings = integration?.settings as any;
    const stateData = settings?.oauthState?.[state];

    if (!stateData) {
      return { valid: false };
    }

    const expiresAt = new Date(stateData.expiresAt);
    if (expiresAt < new Date()) {
      // Clean up expired state
      await this.cleanupOAuthState(integrationId, state);
      return { valid: false };
    }

    return {
      valid: true,
      userId: stateData.userId,
    };
  }

  /**
   * Clean up OAuth state after use
   */
  static async cleanupOAuthState(
    integrationId: number,
    state: string
  ): Promise<void> {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { settings: true },
    });

    const settings = integration?.settings as any;
    if (settings?.oauthState?.[state]) {
      delete settings.oauthState[state];

      await prisma.integration.update({
        where: { id: integrationId },
        data: { settings },
      });
    }
  }

  /**
   * Store user authentication tokens
   */
  static async storeUserAuth(
    userId: string,
    integrationId: number,
    authData: {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: Date;
      additionalData?: any;
    }
  ): Promise<void> {
    const masterKey = getMasterKey();

    // Encrypt tokens
    const encryptedAccessToken = EncryptionService.encrypt(
      authData.accessToken,
      masterKey
    );
    const encryptedRefreshToken = authData.refreshToken
      ? EncryptionService.encrypt(authData.refreshToken, masterKey)
      : null;

    // Deactivate existing auth for this user/integration
    await prisma.userIntegrationAuth.updateMany({
      where: {
        userId,
        integrationId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    // Create new auth record
    await prisma.userIntegrationAuth.create({
      data: {
        userId,
        integrationId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: authData.expiresAt,
        additionalData: authData.additionalData,
        isActive: true,
        lastUsedAt: new Date(),
      },
    });
  }

  /**
   * Get user authentication for an integration
   */
  static async getUserAuth(
    userId: string,
    integrationId: number
  ): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    additionalData?: any;
  } | null> {
    const auth = await prisma.userIntegrationAuth.findFirst({
      where: {
        userId,
        integrationId,
        isActive: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (!auth) {
      return null;
    }

    const masterKey = getMasterKey();

    return {
      accessToken: EncryptionService.decrypt(auth.accessToken, masterKey),
      refreshToken: auth.refreshToken
        ? EncryptionService.decrypt(auth.refreshToken, masterKey)
        : undefined,
      expiresAt: auth.tokenExpiresAt || undefined,
      additionalData: auth.additionalData || undefined,
    };
  }

  /**
   * Refresh OAuth tokens
   */
  static async refreshTokens(
    userId: string,
    integrationId: number,
    refreshToken: string,
    refreshCallback: (refreshToken: string) => Promise<{
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    }>
  ): Promise<boolean> {
    try {
      const result = await refreshCallback(refreshToken);

      const expiresAt = result.expiresIn
        ? new Date(Date.now() + result.expiresIn * 1000)
        : undefined;

      await this.storeUserAuth(userId, integrationId, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken || refreshToken,
        expiresAt,
      });

      return true;
    } catch (error) {
      console.error("Failed to refresh tokens:", error);
      return false;
    }
  }

  /**
   * Store API key authentication
   */
  static async storeApiKeyAuth(
    integrationId: number,
    apiKey: string,
    additionalConfig?: any
  ): Promise<void> {
    const masterKey = getMasterKey();

    // Encrypt the API key
    const encryptedCredentials = EncryptionService.encryptObject(
      {
        apiKey,
        ...additionalConfig,
      },
      masterKey
    );

    await prisma.integration.update({
      where: { id: integrationId },
      data: {
        credentials: encryptedCredentials,
        status: "ACTIVE",
      },
    });
  }

  /**
   * Get API key authentication
   */
  static async getApiKeyAuth(integrationId: number): Promise<{
    apiKey: string;
    [key: string]: any;
  } | null> {
    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { credentials: true },
    });

    if (!integration?.credentials) {
      return null;
    }

    const masterKey = getMasterKey();
    return EncryptionService.decryptObject(
      integration.credentials as string,
      masterKey
    );
  }

  /**
   * Revoke user authentication
   */
  static async revokeUserAuth(
    userId: string,
    integrationId: number
  ): Promise<void> {
    await prisma.userIntegrationAuth.updateMany({
      where: {
        userId,
        integrationId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });
  }

  /**
   * Check if user has active authentication
   */
  static async hasActiveAuth(
    userId: string,
    integrationId: number
  ): Promise<boolean> {
    const auth = await prisma.userIntegrationAuth.findFirst({
      where: {
        userId,
        integrationId,
        isActive: true,
      },
      select: { id: true },
    });

    return !!auth;
  }

  /**
   * Update last used timestamp
   */
  static async updateLastUsed(
    userId: string,
    integrationId: number
  ): Promise<void> {
    await prisma.userIntegrationAuth.updateMany({
      where: {
        userId,
        integrationId,
        isActive: true,
      },
      data: {
        lastUsedAt: new Date(),
      },
    });
  }
}
