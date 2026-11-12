// What the browser may know about the saved connection, and which API key a
// request from the settings form refers to. The saved key itself never leaves
// the backend: the form is told only whether one exists.

export function publicSettings({ instanceUrl, apiKey }) {
  return {
    instanceUrl: instanceUrl || '',
    hasApiKey: Boolean(apiKey),
  };
}

// A key typed into the form, or null when the field was left blank.
export function typedApiKey(value) {
  const typed = typeof value === 'string' ? value.trim() : '';
  return typed || null;
}

// The key a connection test should use: the one just typed, else the saved one.
export function apiKeyToTest(value, savedApiKey) {
  return typedApiKey(value) || savedApiKey || null;
}
