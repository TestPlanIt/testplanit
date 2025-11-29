import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import * as LucideIcons from 'lucide-react';
import './app.css';

const DynamicIcon = ({ name, className = "h-4 w-4", style }) => {
  const IconComponent = LucideIcons[name] || LucideIcons.Circle;
  return <IconComponent className={className} style={style} />;
};

const Settings = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instanceUrl, setInstanceUrl] = useState('');
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await invoke('getSettings');
      if (response.instanceUrl) {
        setInstanceUrl(response.instanceUrl);
      }
    } catch (err) {
      console.error('Error loading settings:', err);
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const validateUrl = (url) => {
    if (!url) return 'URL is required';

    try {
      const urlObj = new URL(url);
      if (!urlObj.protocol.match(/^https?:$/)) {
        return 'URL must use http or https protocol';
      }
      return null;
    } catch (err) {
      return 'Invalid URL format';
    }
  };

  const testConnection = async () => {
    const validationError = validateUrl(instanceUrl);
    if (validationError) {
      setTestStatus({ success: false, message: validationError });
      return;
    }

    setTesting(true);
    setTestStatus(null);

    try {
      const response = await invoke('testConnection', { instanceUrl });
      setTestStatus(response);
    } catch (err) {
      setTestStatus({
        success: false,
        message: err.message || 'Connection test failed'
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    const validationError = validateUrl(instanceUrl);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const response = await invoke('saveSettings', {
        instanceUrl: instanceUrl.replace(/\/$/, '') // Remove trailing slash
      });

      if (response.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(response.error || 'Failed to save settings');
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 testplanit-bg min-h-screen">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary"></div>
          <span className="text-sm text-muted-foreground">Loading settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 testplanit-bg min-h-screen">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground mb-2">TestPlanIt Configuration</h1>
          <p className="text-sm text-muted-foreground">
            Configure your TestPlanIt instance to connect with Jira issues.
          </p>
        </div>

        <div className="bg-card rounded-lg border border-border p-6 mb-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-foreground mb-2">
              TestPlanIt Instance URL
            </label>
            <input
              type="text"
              value={instanceUrl}
              onChange={(e) => {
                setInstanceUrl(e.target.value);
                setTestStatus(null);
                setError(null);
              }}
              placeholder="https://demo.testplanit.com"
              className="w-full px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-2">
              Enter the full URL of your TestPlanIt instance (e.g., https://demo.testplanit.com or https://testplanit.yourcompany.com)
            </p>
          </div>

          <div className="flex gap-3 mb-4">
            <button
              onClick={testConnection}
              disabled={testing || !instanceUrl}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                  Testing...
                </>
              ) : (
                <>
                  <DynamicIcon name="TestTube" className="h-4 w-4" />
                  Test Connection
                </>
              )}
            </button>

            <button
              onClick={handleSave}
              disabled={saving || !instanceUrl}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                  Saving...
                </>
              ) : (
                <>
                  <DynamicIcon name="Save" className="h-4 w-4" />
                  Save Configuration
                </>
              )}
            </button>
          </div>

          {testStatus && (
            <div
              className={`rounded-lg p-4 mb-4 ${
                testStatus.success
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <DynamicIcon
                  name={testStatus.success ? 'CheckCircle' : 'XCircle'}
                  className={`h-5 w-5 mt-0.5 ${
                    testStatus.success ? 'text-green-600' : 'text-red-600'
                  }`}
                />
                <div className="flex-1">
                  <p
                    className={`text-sm font-medium ${
                      testStatus.success ? 'text-green-800' : 'text-red-800'
                    }`}
                  >
                    {testStatus.success ? 'Connection Successful' : 'Connection Failed'}
                  </p>
                  <p
                    className={`text-sm mt-1 ${
                      testStatus.success ? 'text-green-700' : 'text-red-700'
                    }`}
                  >
                    {testStatus.message}
                  </p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-2">
                <DynamicIcon name="AlertCircle" className="h-5 w-5 text-red-600 mt-0.5" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-2">
                <DynamicIcon name="CheckCircle" className="h-5 w-5 text-green-600 mt-0.5" />
                <p className="text-sm text-green-800">Configuration saved successfully!</p>
              </div>
            </div>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <DynamicIcon name="Info" className="h-5 w-5 text-blue-600 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800 mb-2">Setup Instructions</p>
              <ol className="text-sm text-blue-700 space-y-2 list-decimal list-inside">
                <li>Enter your TestPlanIt instance URL above</li>
                <li>Click "Test Connection" to verify the URL is accessible</li>
                <li>Click "Save Configuration" to apply the settings</li>
                <li>Navigate to any Jira issue to see linked TestPlanIt data</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Initialize the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Settings />);
}
