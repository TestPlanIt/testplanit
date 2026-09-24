import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
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

// Instance URL + API key, read together rather than one after the other.
async function getConnection() {
  const [instanceUrl, apiKey] = await Promise.all([
    getInstanceUrl(),
    getApiKey(),
  ]);
  return { instanceUrl, apiKey };
}

// Read the current Jira user's identity so the backend can attribute
// generated cases to the matching TestPlanIt user. Email is the primary
// match key; accountId is a fallback. Both are best-effort — a hidden email
// just means the backend falls back to accountId (or reports an unlinked user).
async function getCurrentJiraUser() {
  try {
    const response = await api
      .asUser()
      .requestJira(route`/rest/api/3/myself`);
    if (!response.ok) {
      return { email: null, accountId: null, displayName: null };
    }
    const data = await response.json();
    return {
      email: data.emailAddress || null,
      accountId: data.accountId || null,
      displayName: data.displayName || null,
    };
  } catch (error) {
    return { email: null, accountId: null, displayName: null };
  }
}

// Headers for authenticated calls to the TestPlanIt backend: the integration
// API key plus the forwarded Jira user identity.
function buildAuthHeaders(apiKey, user) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (apiKey) headers['X-Forge-Api-Key'] = apiKey;
  if (user?.email) headers['X-Forge-User-Email'] = user.email;
  if (user?.accountId) headers['X-Forge-User-Account-Id'] = user.accountId;
  return headers;
}

resolver.define('getTestInfo', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    const { instanceUrl, apiKey } = await getConnection();

    if (!instanceUrl) {
      return {
        error: 'TestPlanIt instance URL not configured. Please configure it in the app settings.',
        notConfigured: true
      };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');
    // runCases=lazy: each run's per-case status bar is fetched by
    // getTestRunCases when the user expands the run. Instances that predate it
    // ignore the flag and send the bar inline, which the panel still renders.
    const apiUrl = `${cleanUrl}/api/integrations/jira/test-info?issueKey=${issueKey}&issueId=${issueId}&runCases=lazy`;

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

// One linked run's per-case status-bar segments, fetched when the user
// expands the run in the panel.
resolver.define('getTestRunCases', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    const { instanceUrl, apiKey } = await getConnection();
    if (!instanceUrl) {
      return { error: 'TestPlanIt instance URL not configured.', notConfigured: true };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');
    const qs = new URLSearchParams();
    if (issueKey) qs.set('issueKey', issueKey);
    if (issueId) qs.set('issueId', issueId);
    qs.set('testRunId', String(payload?.testRunId));

    const response = await api.fetch(
      `${cleanUrl}/api/integrations/jira/test-run-cases?${qs.toString()}`,
      { method: 'GET', headers: buildAuthHeaders(apiKey) }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: data.error || `Failed to load test run cases (${response.status})` };
    }
    return { displayItems: data.displayItems || [] };
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
    const { instanceUrl, apiKey } = await getConnection();
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

// --- Generate Test Cases (AI) ---------------------------------------------

// Fetch the projects/templates/readiness the panel needs to drive the
// generation flow. Pass an optional projectId to re-resolve templates +
// readiness when the user switches project.
resolver.define('getGenerationContext', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    const [{ instanceUrl, apiKey }, user] = await Promise.all([
      getConnection(),
      getCurrentJiraUser(),
    ]);
    if (!instanceUrl) {
      return {
        error: 'TestPlanIt instance URL not configured.',
        notConfigured: true,
      };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');

    const qs = new URLSearchParams();
    if (issueKey) qs.set('issueKey', issueKey);
    if (issueId) qs.set('issueId', issueId);
    if (payload?.projectId) qs.set('projectId', String(payload.projectId));

    const response = await api.fetch(
      `${cleanUrl}/api/integrations/jira/generate-context?${qs.toString()}`,
      { method: 'GET', headers: buildAuthHeaders(apiKey, user) }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: data.error || `Failed to load context (${response.status})` };
    }
    return data;
  } catch (error) {
    return { error: error.message };
  }
});

// Persist the confirmed cases and link them to the issue.
resolver.define('importTestCases', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    const [{ instanceUrl, apiKey }, user] = await Promise.all([
      getConnection(),
      getCurrentJiraUser(),
    ]);
    if (!instanceUrl) {
      return { error: 'TestPlanIt instance URL not configured.', notConfigured: true };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');

    const response = await api.fetch(
      `${cleanUrl}/api/integrations/jira/import-test-cases`,
      {
        method: 'POST',
        headers: buildAuthHeaders(apiKey, user),
        body: JSON.stringify({
          projectId: payload?.projectId,
          templateId: payload?.templateId,
          issueKey,
          issueId,
          issueTitle: payload?.issueTitle,
          issueUrl: payload?.issueUrl,
          autoGenerateTags: payload?.autoGenerateTags,
          testCases: payload?.testCases,
          folderId: payload?.folderId,
          newFolderName: payload?.newFolderName,
        }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: data.error || data.message || `Import failed (${response.status})` };
    }
    return data;
  } catch (error) {
    return { error: error.message };
  }
});

// Mint a short-lived token so the panel can stream generation directly from
// the browser (Forge resolvers can't run the >25s LLM call). Returns the token
// + instance URL the frontend fetches against.
resolver.define('getGenerateToken', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    const [{ instanceUrl, apiKey }, user] = await Promise.all([
      getConnection(),
      getCurrentJiraUser(),
    ]);
    if (!instanceUrl) {
      return { error: 'TestPlanIt instance URL not configured.', notConfigured: true };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');

    const response = await api.fetch(
      `${cleanUrl}/api/integrations/jira/generate-token`,
      {
        method: 'POST',
        headers: buildAuthHeaders(apiKey, user),
        body: JSON.stringify({
          projectId: payload?.projectId,
          issueKey,
          issueId,
        }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        error: data.error || `Failed to start generation (${response.status})`,
      };
    }
    return { token: data.token, instanceUrl: cleanUrl };
  } catch (error) {
    return { error: error.message };
  }
});

// --- Generate QuickScript (AI test-script) --------------------------------

// Fetch the projects/export-templates/readiness + issue-linked cases the panel
// needs to drive the QuickScript flow. Pass an optional projectId to re-resolve
// when the user switches project.
resolver.define('getQuickScriptContext', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    const [{ instanceUrl, apiKey }, user] = await Promise.all([
      getConnection(),
      getCurrentJiraUser(),
    ]);
    if (!instanceUrl) {
      return {
        error: 'TestPlanIt instance URL not configured.',
        notConfigured: true,
      };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');

    const qs = new URLSearchParams();
    if (issueKey) qs.set('issueKey', issueKey);
    if (issueId) qs.set('issueId', issueId);
    if (payload?.projectId) qs.set('projectId', String(payload.projectId));

    const response = await api.fetch(
      `${cleanUrl}/api/integrations/jira/quickscript-context?${qs.toString()}`,
      { method: 'GET', headers: buildAuthHeaders(apiKey, user) }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: data.error || `Failed to load context (${response.status})` };
    }
    return data;
  } catch (error) {
    return { error: error.message };
  }
});

// Mint a short-lived token so the panel can stream QuickScript generation
// directly from the browser (Forge resolvers can't run the >25s LLM call).
resolver.define('getQuickScriptToken', async ({ context, payload }) => {
  const issueKey = context.extension?.issue?.key;
  const issueId = context.extension?.issue?.id;

  try {
    const [{ instanceUrl, apiKey }, user] = await Promise.all([
      getConnection(),
      getCurrentJiraUser(),
    ]);
    if (!instanceUrl) {
      return { error: 'TestPlanIt instance URL not configured.', notConfigured: true };
    }

    const cleanUrl = instanceUrl.replace(/\/+$/, '');

    const response = await api.fetch(
      `${cleanUrl}/api/integrations/jira/quickscript-token`,
      {
        method: 'POST',
        headers: buildAuthHeaders(apiKey, user),
        body: JSON.stringify({
          projectId: payload?.projectId,
          issueKey,
          issueId,
        }),
      }
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        error: data.error || `Failed to start generation (${response.status})`,
      };
    }
    return { token: data.token, instanceUrl: cleanUrl };
  } catch (error) {
    return { error: error.message };
  }
});

export const handler = resolver.getDefinitions();