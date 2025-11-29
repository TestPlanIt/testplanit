import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { prisma } from "@/lib/prisma";
import { IntegrationProvider } from "@prisma/client";
import { decrypt, isEncrypted } from "@/utils/encryption";

interface TestConnectionRequest {
  integrationId?: number;
  provider?: IntegrationProvider;
  authType?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, string>;
}

async function testJiraConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>,
  authType?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check for API key auth
    const { email, apiToken, clientId, clientSecret } = credentials;
    const { baseUrl, cloudId } = settings;

    if (authType === "API_KEY" || (email && apiToken)) {
      // API Key authentication
      if (!email || !apiToken || !baseUrl) {
        return {
          success: false,
          error: "Missing required Jira API key configuration (email, apiToken, baseUrl)",
        };
      }

      // Test connection using API key
      const response = await fetch(
        `${baseUrl}/rest/api/3/myself`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Jira API returned ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true };
    } else {
      // OAuth2 authentication
      if (!clientId || !clientSecret || !cloudId) {
        return {
          success: false,
          error: "Missing required Jira OAuth2 configuration",
        };
      }

      // Test basic connectivity to Jira API
      // This is a placeholder - in production, you'd use proper OAuth flow
      const response = await fetch(
        `https://api.atlassian.com/oauth/token/accessible-resources`,
        {
          headers: {
            Authorization: `Bearer ${clientSecret}`, // This would be the actual OAuth token
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Jira API returned ${response.status}: ${response.statusText}`,
        };
      }

      return { success: true };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function testGithubConnection(
  credentials: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { personalAccessToken } = credentials;

    if (!personalAccessToken) {
      return {
        success: false,
        error: "Missing personal access token",
      };
    }

    // Test GitHub API connection
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${personalAccessToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `GitHub API returned ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function testAzureDevOpsConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { personalAccessToken } = credentials;
    const { organizationUrl } = settings;

    if (!personalAccessToken || !organizationUrl) {
      return {
        success: false,
        error: "Missing required Azure DevOps configuration",
      };
    }

    // Test Azure DevOps API connection
    const response = await fetch(
      `${organizationUrl}/_apis/projects?api-version=6.0`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `:${personalAccessToken}`
          ).toString("base64")}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: `Azure DevOps API returned ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function testSimpleUrlConnection(
  credentials: Record<string, string>,
  settings: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  try {
    const { baseUrl } = settings;

    if (!baseUrl) {
      return {
        success: false,
        error: "Missing required URL pattern",
      };
    }

    // Validate that baseUrl contains {issueId} placeholder
    if (!baseUrl.includes("{issueId}")) {
      return {
        success: false,
        error: "URL pattern must include {issueId} placeholder",
      };
    }

    // For SIMPLE_URL, we just validate the URL format
    // There's no actual connection to test
    try {
      // Test with a sample issue ID
      const testUrl = baseUrl.replace("{issueId}", "TEST-123");
      new URL(testUrl); // This will throw if URL is invalid
    } catch (urlError) {
      return {
        success: false,
        error: "Invalid URL pattern",
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: TestConnectionRequest = await req.json();
    const { integrationId, provider, credentials, settings } = body;

    let testProvider = provider;
    const testCredentials = credentials || {};
    let testSettings = settings || {};

    let authType: string | undefined = body.authType;

    // If integrationId is provided, fetch the integration details
    if (integrationId) {
      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
      });

      if (!integration) {
        return NextResponse.json(
          { success: false, error: "Integration not found" },
          { status: 404 }
        );
      }

      testProvider = integration.provider;
      authType = integration.authType;

      // Decrypt stored credentials for testing
      if (
        integration.credentials &&
        typeof integration.credentials === "object"
      ) {
        // Check if credentials are stored with an 'encrypted' key (PUT route format)
        if ('encrypted' in integration.credentials && typeof integration.credentials.encrypted === 'string') {
          try {
            const decrypted = await decrypt(integration.credentials.encrypted);
            Object.assign(testCredentials, JSON.parse(decrypted));
          } catch (e) {
            console.error('Failed to decrypt credentials:', e);
          }
        } else {
          // Handle individual field encryption or plain text
          const encryptedCreds = integration.credentials as Record<
            string,
            string
          >;
          for (const [key, value] of Object.entries(encryptedCreds)) {
            if (value && typeof value === "string") {
              try {
                // Check if the value is encrypted using the utility function
                if (isEncrypted(value)) {
                  testCredentials[key] = await decrypt(value);
                } else {
                  // If not encrypted, use as-is
                  testCredentials[key] = value;
                }
              } catch (e) {
                // If decryption fails, use the value as-is
                console.warn(`Failed to decrypt credential ${key}, using as-is`);
                testCredentials[key] = value;
              }
            }
          }
        }
      }

      if (integration.settings && typeof integration.settings === "object") {
        testSettings = integration.settings as Record<string, string>;
      }
    }

    if (!testProvider) {
      return NextResponse.json(
        { success: false, error: "Provider not specified" },
        { status: 400 }
      );
    }

    // Test connection based on provider
    let result: { success: boolean; error?: string };

    switch (testProvider) {
      case IntegrationProvider.JIRA:
        result = await testJiraConnection(testCredentials, testSettings, authType);
        break;
      case IntegrationProvider.GITHUB:
        result = await testGithubConnection(testCredentials);
        break;
      case IntegrationProvider.AZURE_DEVOPS:
        result = await testAzureDevOpsConnection(testCredentials, testSettings);
        break;
      case IntegrationProvider.SIMPLE_URL:
        result = await testSimpleUrlConnection(testCredentials, testSettings);
        break;
      default:
        result = {
          success: false,
          error: `Unsupported provider: ${testProvider}`,
        };
    }

    // Update integration status if testing an existing integration
    if (integrationId && result.success) {
      await prisma.integration.update({
        where: { id: integrationId },
        data: {
          status: "ACTIVE",
          lastSyncAt: new Date(),
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Test connection error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
