import Resolver from '@forge/resolver';
import api from '@forge/api';
import { kvs } from '@forge/kvs';

const resolver = new Resolver();

// Storage keys
const INSTANCE_URL_KEY = 'testplanit_instance_url';
const API_KEY_KEY = 'testplanit_api_key';

async function getInstanceUrl() {
  const url = await kvs.get(INSTANCE_URL_KEY);
  return url || null;
}

async function getApiKey() {
  const key = await kvs.get(API_KEY_KEY);
  return key || null;
}

resolver.define('getTestInfo', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    // Get the configured instance URL
    const instanceUrl = await getInstanceUrl();

    if (!instanceUrl) {
      return {
        error: 'TestPlanIt instance URL not configured. Please configure it in the app settings.',
        notConfigured: true
      };
    }

    const apiKey = await getApiKey();
    const cleanUrl = instanceUrl.replace(/\/+$/, '');
    const apiUrl = `${cleanUrl}/api/integrations/jira/test-info?issueKey=${issueKey}&issueId=${issueId}`;

    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['X-Forge-Api-Key'] = apiKey;
    }

    const response = await api.fetch(apiUrl, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch test info: ${response.status}`);
    }

    const data = await response.json();

    return {
      issueKey,
      issueId,
      instanceUrl,
      testCases: data.testCases || [],
      sessions: data.sessions || [],
      testRuns: data.testRuns || []
    };
  } catch (error) {
    return { error: error.message };
  }
});

resolver.define('openUrl', async ({ payload }) => {
  return {
    success: false, // Indicate frontend should handle the redirect
    url: payload.url
  };
});

// Settings management resolvers
resolver.define('getSettings', async () => {
  try {
    const instanceUrl = await getInstanceUrl();
    const apiKey = await getApiKey();
    return { instanceUrl: instanceUrl || '', apiKey: apiKey || '' };
  } catch (error) {
    return { error: error.message };
  }
});

resolver.define('saveSettings', async ({ payload }) => {
  try {
    const { instanceUrl, apiKey } = payload;

    if (!instanceUrl) {
      return { success: false, error: 'Instance URL is required' };
    }

    try {
      new URL(instanceUrl);
    } catch (err) {
      return { success: false, error: 'Invalid URL format' };
    }

    const cleanUrl = instanceUrl.replace(/\/$/, '');

    await kvs.set(INSTANCE_URL_KEY, cleanUrl);

    if (apiKey !== undefined) {
      if (apiKey) {
        await kvs.set(API_KEY_KEY, apiKey);
      } else {
        await kvs.delete(API_KEY_KEY);
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

resolver.define('testConnection', async ({ payload }) => {
  try {
    const { instanceUrl, apiKey } = payload;

    if (!instanceUrl) {
      return { success: false, message: 'Instance URL is required' };
    }

    if (!apiKey) {
      return { success: false, message: 'API Key is required' };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');

    // First check the instance is reachable
    const versionUrl = `${cleanUrl}/version.json`;
    const versionResponse = await api.fetch(versionUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!versionResponse.ok) {
      return {
        success: false,
        message: `Could not reach TestPlanIt instance (status ${versionResponse.status}). Please check the URL.`
      };
    }

    const versionData = await versionResponse.json();

    // Validate the API key using the test-connection endpoint
    const testUrl = `${cleanUrl}/api/integrations/jira/test-connection`;
    const testResponse = await api.fetch(testUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Forge-Api-Key': apiKey
      }
    });

    if (testResponse.status === 401 || testResponse.status === 403) {
      return {
        success: false,
        message: 'Instance is reachable but the API key is invalid or expired. Please check your key in Admin > Integrations > Jira.'
      };
    }

    if (!testResponse.ok) {
      return {
        success: false,
        message: `Connection test returned status ${testResponse.status}. Please ensure your TestPlanIt instance is v0.15.4 or later.`
      };
    }

    return {
      success: true,
      message: `Successfully connected to TestPlanIt ${versionData.version || 'instance'} — API key is valid.`
    };
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error.message}`
    };
  }
});

resolver.define('clearSettings', async () => {
  try {
    await kvs.delete(INSTANCE_URL_KEY);
    await kvs.delete(API_KEY_KEY);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

export const handler = resolver.getDefinitions();