import Resolver from '@forge/resolver';
import api, { route, storage } from '@forge/api';

const resolver = new Resolver();

// Storage key for instance URL
const INSTANCE_URL_KEY = 'testplanit_instance_url';

// Helper function to get the stored instance URL
async function getInstanceUrl() {
  const url = await storage.get(INSTANCE_URL_KEY);
  return url || null;
}

resolver.define('getTestInfo', async ({ context, payload }) => {
  console.log('Forge: getTestInfo called, context:', JSON.stringify(context, null, 2));

  // The issue data is in context.extension.issue
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  console.log('Forge: Getting test info for issue:', { issueKey, issueId });

  try {
    // Get the configured instance URL
    const instanceUrl = await getInstanceUrl();

    if (!instanceUrl) {
      return {
        error: 'TestPlanIt instance URL not configured. Please configure it in the app settings.',
        notConfigured: true
      };
    }

    // Call TestPlanIt backend to get linked test information
    const apiUrl = `${instanceUrl}/api/integrations/jira/test-info?issueKey=${issueKey}&issueId=${issueId}`;
    console.log('Forge: Fetching from:', apiUrl);

    const response = await api.fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch test info: ${response.status}`);
    }

    const data = await response.json();
    console.log('Forge: Received data:', data);

    // Include issue context and instance URL in the response
    return {
      issueKey,
      issueId,
      instanceUrl,
      testCases: data.testCases || [],
      sessions: data.sessions || [],
      testRuns: data.testRuns || []
    };
  } catch (error) {
    console.error('Forge: Error fetching test info:', error);
    return { error: error.message };
  }
});

resolver.define('linkIssueToTest', async ({ context, payload }) => {
  const { issueKey } = context.extension.issue;
  const { testCaseId, testRunId } = payload;

  try {
    // Get the configured instance URL
    const instanceUrl = await getInstanceUrl();

    if (!instanceUrl) {
      return { error: 'TestPlanIt instance URL not configured' };
    }

    const apiUrl = `${instanceUrl}/api/integrations/jira/link-issue`;
    const response = await api.fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        issueKey,
        testCaseId,
        testRunId
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to link issue: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error linking issue:', error);
    return { error: error.message };
  }
});

resolver.define('openUrl', async ({ context, payload }) => {
  console.log('Forge: Opening URL:', payload.url);

  // For Forge Custom UI, we need the frontend to handle URL opening
  // since we can't directly manipulate the browser from the resolver.
  // Return the URL for the frontend to handle with window.location
  return {
    success: false, // Indicate frontend should handle the redirect
    url: payload.url
  };
});

// Settings management resolvers
resolver.define('getSettings', async () => {
  try {
    const instanceUrl = await getInstanceUrl();
    return { instanceUrl: instanceUrl || '' };
  } catch (error) {
    console.error('Error getting settings:', error);
    return { error: error.message };
  }
});

resolver.define('saveSettings', async ({ payload }) => {
  try {
    const { instanceUrl } = payload;

    // Validate URL format
    if (!instanceUrl) {
      return { success: false, error: 'Instance URL is required' };
    }

    try {
      new URL(instanceUrl);
    } catch (err) {
      return { success: false, error: 'Invalid URL format' };
    }

    // Remove trailing slash
    const cleanUrl = instanceUrl.replace(/\/$/, '');

    // Save to storage
    await storage.set(INSTANCE_URL_KEY, cleanUrl);

    console.log('Forge: Saved instance URL:', cleanUrl);
    return { success: true };
  } catch (error) {
    console.error('Error saving settings:', error);
    return { success: false, error: error.message };
  }
});

resolver.define('testConnection', async ({ payload }) => {
  try {
    const { instanceUrl } = payload;

    if (!instanceUrl) {
      return { success: false, message: 'Instance URL is required' };
    }

    // Test connection to the instance by fetching version.json
    const testUrl = `${instanceUrl}/version.json`;
    console.log('Forge: Testing connection to:', testUrl);

    const response = await api.fetch(testUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const versionData = await response.json();
      return {
        success: true,
        message: `Successfully connected to TestPlanIt ${versionData.version || 'instance'}`
      };
    } else {
      return {
        success: false,
        message: `Connection failed with status ${response.status}. Please check the URL and try again.`
      };
    }
  } catch (error) {
    console.error('Error testing connection:', error);
    return {
      success: false,
      message: `Connection failed: ${error.message}`
    };
  }
});

resolver.define('clearSettings', async () => {
  try {
    await storage.delete(INSTANCE_URL_KEY);
    console.log('Forge: Cleared instance URL from storage');
    return { success: true };
  } catch (error) {
    console.error('Error clearing settings:', error);
    return { success: false, error: error.message };
  }
});

export const handler = resolver.getDefinitions();