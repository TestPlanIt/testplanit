import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, router, view } from '@forge/bridge';
import * as LucideIcons from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import './app.css';

// Status badge component using backend color data
const StatusBadge = ({ status, statusColor, icon, className = "", width = "w-20" }) => {
  const badgeStyle = statusColor ? {
    backgroundColor: statusColor,
    color: 'var(--ds-text-inverse, white)',
    borderColor: statusColor
  } : {
    backgroundColor: 'var(--ds-background-neutral, #6B7280)',
    color: 'var(--ds-text-inverse, white)',
    borderColor: 'var(--ds-border-neutral, #6B7280)'
  };

  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-medium border gap-1 ${width} ${className}`}
      style={badgeStyle}
      title={status} // Show full text on hover
    >
      {icon && <DynamicIcon name={icon} className="h-3 w-3 shrink-0" style={{ color: 'white' }} />}
      <span className="truncate">{status}</span>
    </span>
  );
};

// Dynamic icon component that maps icon names to Lucide React icons
const DynamicIcon = ({ name, className = "h-4 w-4", style }) => {
  if (!name) return null;

  // Convert icon name to PascalCase for Lucide React
  // Handle common transformations: kebab-case, snake_case, etc.
  const toPascalCase = (str) => {
    return str
      .split(/[-_\s]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  };

  // Try different variations of the icon name
  const iconVariations = [
    name, // exact match
    toPascalCase(name), // PascalCase
    name.charAt(0).toUpperCase() + name.slice(1), // Capitalize first letter
    name.toLowerCase(), // lowercase
    name.toUpperCase(), // uppercase
  ];

  // Special mappings for common single-character or symbol icons
  const specialMappings = {
    '●': 'Circle',
    '○': 'Circle',
    '◯': 'Circle',
    '◐': 'PauseCircle',
    '✓': 'Check',
    '✗': 'X',
    '!': 'AlertTriangle',
    '⏸': 'Pause',
    '▶': 'Play',
    '⏹': 'Square',
    '🕐': 'Clock',
    // Single letter common mappings
    'o': 'Circle',
    'c': 'Check',
    'x': 'X',
    'p': 'Play',
    's': 'Square',
    't': 'Clock'
  };

  // Check special mappings first
  if (specialMappings[name]) {
    iconVariations.unshift(specialMappings[name]);
  }

  // Try to find the icon in Lucide React
  let IconComponent = null;
  for (const variation of iconVariations) {
    if (LucideIcons[variation]) {
      IconComponent = LucideIcons[variation];
      break;
    }
  }

  // Fallback to Circle if no icon found
  if (!IconComponent) {
    IconComponent = LucideIcons.Circle;
  }

  return <IconComponent className={className} style={style} />;
};

// Utility function to format duration in seconds to human readable format
const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return null;

  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const mins = Math.floor((seconds % (60 * 60)) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
  if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts.join(', ');
  return `${parts.slice(0, -1).join(', ')}, ${parts[parts.length - 1]}`;
};

// Utility function to format time like TestPlanIt's ElapsedTime component
const formatElapsedTime = (totalSeconds) => {
  if (!totalSeconds || totalSeconds <= 0) return 'No time recorded';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

  return parts.join(', ');
};

// Test case row component
const TestCaseRow = ({ testCase, onOpen }) => {
  const [expanded, setExpanded] = useState(false);

  const getIcon = (source, isDeleted) => {
    if (isDeleted) return <DynamicIcon name="Trash2" className="h-4 w-4 shrink-0" />;
    if (source === 'JUNIT') return <DynamicIcon name="Bot" className="h-4 w-4 shrink-0" />;
    return <DynamicIcon name="ListChecks" className="h-4 w-4 shrink-0" />;
  };

  const getStatusStyle = (statusColor) => {
    if (statusColor) {
      return {
        backgroundColor: statusColor,
        color: 'white',
        borderColor: statusColor
      };
    }
    // Fallback for cases without color data
    return {
      backgroundColor: 'var(--ds-background-neutral, #6B7280)',
      color: 'var(--ds-text-inverse, white)',
      borderColor: 'var(--ds-border-neutral, #6B7280)'
    };
  };

  const getResultBadgeStyle = (resultColor) => {
    if (resultColor) {
      return {
        backgroundColor: resultColor,
        color: 'white',
        borderColor: resultColor
      };
    }
    return {
      backgroundColor: 'var(--ds-background-neutral, #6B7280)',
      color: 'var(--ds-text-inverse, white)',
      borderColor: 'var(--ds-border-neutral, #6B7280)'
    };
  };

  const handleTitleClick = (e) => {
    e.stopPropagation();
    onOpen(testCase.id, testCase.projectId);
  };

  const toggleExpanded = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className="testplanit-card border rounded-md transition-colors">
      <div className="flex items-center justify-between p-2 testplanit-hover">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {getIcon(testCase.source, testCase.isDeleted)}
          <button
            className="text-sm font-medium testplanit-primary flex-1 truncate text-left"
            onClick={handleTitleClick}
            title={testCase.name}
          >
            {testCase.name}
          </button>
          {(testCase.estimate || testCase.forecastManual || testCase.forecastAutomated) && (
            <div className="flex items-center gap-1">
              {testCase.estimate && (
                <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
                  Est: {formatDuration(testCase.estimate)}
                </span>
              )}
              {testCase.forecastManual && (
                <span className="text-xs testplanit-primary testplanit-muted-bg px-2 py-1 rounded">
                  Forecast: {formatDuration(testCase.forecastManual)}
                </span>
              )}
              {testCase.forecastAutomated && (
                <span className="text-xs testplanit-primary testplanit-muted-bg px-2 py-1 rounded">
                  Auto: {formatDuration(Math.round(testCase.forecastAutomated))}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Workflow State */}
            <span
              className="text-xs px-2 py-1 rounded-md border font-medium flex items-center justify-center gap-1 w-20"
              style={getStatusStyle(testCase.statusColor)}
              title={testCase.status}
            >
              <DynamicIcon name={testCase.statusIcon} className="h-3 w-3 shrink-0" style={{ color: 'white' }} />
              <span className="truncate">{testCase.status}</span>
            </span>
            {/* Test Result Status Badge */}
            {testCase.lastResult && (
              <span
                className="text-xs px-2 py-1 rounded-md border font-medium flex items-center justify-center w-20"
                style={getResultBadgeStyle(testCase.lastResultColor)}
                title={testCase.lastResult}
              >
                <span className="truncate">{testCase.lastResult}</span>
              </span>
            )}
          </div>
        </div>
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors ml-2"
          onClick={toggleExpanded}
        >
          {expanded ? <DynamicIcon name="ChevronDown" className="h-4 w-4" /> : <DynamicIcon name="ChevronRight" className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-muted/30">
          <div className="p-2">
            {testCase.resultHistory && testCase.resultHistory.length > 0 ? (
              <div className="bg-card rounded border-border border justify-center">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-2 px-2 py-1 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground rounded-t items-center">
                  <div className="col-span-3">Test Run</div>
                  <div className="col-span-2">Status</div>
                  <div className="col-span-2">Executed By</div>
                  <div className="col-span-2">Executed At</div>
                  <div className="col-span-1">Edited</div>
                  <div className="col-span-1">Duration</div>
                  <div className="col-span-1">Version</div>
                </div>
                {/* Table Rows */}
                {testCase.resultHistory.map((result, index) => {
                  // Use the actual test run completion status from the API
                  const isTestRunCompleted = result.testRunIsCompleted || false;

                  return (
                    <div key={index} className={`grid grid-cols-12 gap-2 px-2 py-2 text-xs items-center border-b border-border last:border-b-0 hover:bg-muted/50 ${isTestRunCompleted ? 'completed-test-run' : ''}`}>
                      <div className="col-span-3">
                        <div className="flex items-center gap-1 min-w-0">
                          <DynamicIcon name="PlayCircle" className="h-3 w-3 text-muted-foreground shrink-0" />
                          {result.testRunId && result.testRunId !== null ? (
                            <button
                              className="truncate font-medium text-primary hover:text-primary/80 hover:underline text-left min-w-0"
                              title={result.testRunName}
                              onClick={async () => {
                                if (!instanceUrl) return;
                                const url = `${instanceUrl}/projects/runs/${testCase.projectId}/${result.testRunId}?selectedCase=${testCase.id}&view=status`;
                                console.log('Opening test run URL:', url);
                                try {
                                  await router.open(url);
                                  console.log('Successfully opened test run via Forge router.open()');
                                } catch (routerError) {
                                  console.log('Forge router.open() failed, trying router.navigate():', routerError);
                                  try {
                                    await router.navigate(url);
                                    console.log('Successfully navigated via Forge router.navigate()');
                                  } catch (navigateError) {
                                    console.log('Forge router.navigate() failed:', navigateError);
                                    window.location.href = url;
                                  }
                                }
                              }}
                            >
                              {result.testRunName}
                            </button>
                          ) : (
                            <span className="truncate font-medium min-w-0" title={result.testRunName}>
                              {result.testRunName}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2 flex justify-start">
                        <span
                          className="px-2 py-1 rounded-md border font-medium inline-flex items-center justify-center w-16"
                          style={{
                            backgroundColor: result.statusColor || 'var(--ds-background-neutral, #6B7280)',
                            color: 'var(--ds-text-inverse, white)',
                            borderColor: result.statusColor || 'var(--ds-border-neutral, #6B7280)',
                            fontSize: '10px'
                          }}
                          title={result.status}
                        >
                          <span className="truncate">{result.status}</span>
                        </span>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <span className="truncate text-xs block" title={result.executedBy?.name}>
                          {result.executedBy?.name || 'Unknown'}
                        </span>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate block" title={new Date(result.executedAt).toLocaleString()}>
                          {formatDistanceToNow(new Date(result.executedAt), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        {result.editedBy ? (
                          <DynamicIcon name="History" className="h-3 w-3 text-muted-foreground" title={`Edited by ${result.editedBy.name}`} />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                      <div className="col-span-1 flex items-center justify-center min-w-0">
                        {result.elapsed ? (
                          <span className="text-xs text-muted-foreground truncate" title={formatDuration(result.elapsed)}>
                            {formatDuration(result.elapsed)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        <span className="text-xs font-medium text-muted-foreground">
                          {result.testRunCaseVersion || '-'}
                        </span>
                      </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-4">No test results available</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// Session row component
const SessionRow = ({ session, onOpen }) => {
  const [expanded, setExpanded] = useState(false);

  // Use display items from API (like SessionResultsSummary)
  const displayItems = session.displayItems || [];
  const hasResults = displayItems.length > 0;
  const resultSummary = hasResults
    ? session.hasElapsed
      ? `${session.total} results`
      : `${session.total} results (no time)`
    : 'No results';

  const handleTitleClick = (e) => {
    e.stopPropagation();
    onOpen(session.id, session.projectId);
  };

  const toggleExpanded = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className="testplanit-card border rounded-md mb-1 transition-colors">
      <div className="flex items-center justify-between p-2 testplanit-hover">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <DynamicIcon name="Compass" className="h-4 w-4 shrink-0" />
          <button
            className="text-sm font-medium testplanit-primary flex-1 truncate text-left"
            onClick={handleTitleClick}
            title={session.name}
          >
            {session.name}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
              {resultSummary}
            </span>
            <StatusBadge
              status={session.status}
              statusColor={session.statusColor}
              icon={session.statusIcon}
            />
          </div>
        </div>
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors ml-2"
          onClick={toggleExpanded}
        >
          {expanded ? <DynamicIcon name="ChevronDown" className="h-4 w-4" /> : <DynamicIcon name="ChevronRight" className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-muted/30">
          <div className="p-2">
            <div className="testplanit-card rounded border-border border p-3">
              <div className="flex flex-col space-y-3">
                {hasResults ? (
                  <>
                    {/* Status Bar Visualization */}
                    <div className="flex flex-col space-y-1">
                      <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted">
                        {/* Individual segments for each session result with actual status colors (like SessionResultsSummary) */}
                        {displayItems.map((result, index) => {
                          const color = result.status?.color?.value || '#9ca3af';

                          // Calculate width based on elapsed time if available, otherwise equal distribution
                          let width;
                          if (session.hasElapsed) {
                            if (result.elapsed && result.elapsed > 0) {
                              width = `${Math.max(5, (result.elapsed / session.totalElapsed) * 100)}%`;
                            } else {
                              width = '5%'; // Minimum width for results with no elapsed time
                            }
                          } else {
                            width = `${100 / displayItems.length}%`; // Equal distribution
                          }

                          return (
                            <div
                              key={`${result.id}-${index}`}
                              className="h-full transition-all border-x-[0.5px] border-primary-foreground"
                              style={{
                                backgroundColor: color,
                                width: width,
                                minWidth: '4px'
                              }}
                              title={`Result ${index + 1}: ${result.status?.name}${result.elapsed ? ` (${result.elapsed}s)` : ''}`}
                            />
                          );
                        })}
                      </div>
                      <div className="text-xs testplanit-text-muted">
                        Total: {session.total} results{session.summaryText ? ` (${session.summaryText})` : ''}
                      </div>
                      {session.hasElapsed && session.totalElapsed > 0 && (
                        <div className="text-xs testplanit-text-muted mt-1 space-y-1">
                          <div className="flex items-center gap-1">
                            <DynamicIcon name="Timer" className="h-3 w-3" />
                            <span>Time Spent: {formatElapsedTime(session.totalElapsed)}</span>
                          </div>
                          {session.estimate && (
                            <div className="flex items-center gap-1">
                              {session.totalElapsed > session.estimate ? (
                                <>
                                  <DynamicIcon name="ClockAlert" className="h-3 w-3 text-red-500" />
                                  <span className="text-red-500">
                                    Over the Estimate by: {formatElapsedTime(session.totalElapsed - session.estimate)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <DynamicIcon name="AlarmClockPlus" className="h-3 w-3" />
                                  <span>
                                    Remaining: {formatElapsedTime(session.estimate - session.totalElapsed)}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-xs testplanit-text-muted text-center py-4">
                    No session results recorded yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Test run row component
const TestRunRow = ({ testRun, onOpen }) => {
  const [expanded, setExpanded] = useState(false);

  // Use display items from API (like TestRunCasesSummary)
  const displayItems = testRun.displayItems || [];
  const passedCount = displayItems.filter(item => item.status?.name === 'Passed').length;
  const passRate = testRun.total > 0 ? Math.round((passedCount / testRun.total) * 100) : 0;

  const handleTitleClick = (e) => {
    e.stopPropagation();
    onOpen(testRun.id, testRun.projectId);
  };

  const toggleExpanded = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className="testplanit-card border rounded-md mb-1 transition-colors">
      <div className="flex items-center justify-between p-2 testplanit-hover">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <DynamicIcon name="PlayCircle" className="h-4 w-4 shrink-0" />
          <button
            className="text-sm font-medium testplanit-primary flex-1 truncate text-left"
            onClick={handleTitleClick}
            title={testRun.name}
          >
            {testRun.name}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
              {passRate}% passed
            </span>
            <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
              {testRun.total} cases
            </span>
            <StatusBadge
              status={testRun.status}
              statusColor={testRun.statusColor}
              icon={testRun.statusIcon}
            />
          </div>
        </div>
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors ml-2"
          onClick={toggleExpanded}
        >
          {expanded ? <DynamicIcon name="ChevronDown" className="h-4 w-4" /> : <DynamicIcon name="ChevronRight" className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-muted/30">
          <div className="p-2">
            <div className="testplanit-card rounded border-border border p-3">
              <div className="flex flex-col space-y-3">
                {/* Status Bar Visualization */}
                <div className="flex flex-col space-y-1">
                  <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted">
                    {/* Individual segments for each test case with actual status colors (like TestRunCasesSummary) */}
                    {displayItems.map((item, index) => {
                      const color = item.status?.color?.value || '#9ca3af';
                      return (
                        <div
                          key={`${item.id}-${index}`}
                          className="h-full transition-all border-x-[0.5px] border-primary-foreground"
                          style={{
                            backgroundColor: color,
                            width: `${100 / displayItems.length}%`,
                            minWidth: '4px'
                          }}
                          title={`${item.testCaseName}: ${item.status?.name}`}
                        />
                      );
                    })}
                  </div>
                  <div className="text-xs testplanit-text-muted">
                    Total: {testRun.total} cases{testRun.summaryText ? ` (${testRun.summaryText})` : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


// Main app component
const App = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testData, setTestData] = useState(null);
  const [instanceUrl, setInstanceUrl] = useState(null);
  const [, setIsDarkTheme] = useState(false);

  // Section collapse state
  const [sectionsExpanded, setSectionsExpanded] = useState({
    testCases: true,
    testRuns: true,
    sessions: true
  });

  const toggleSection = (section) => {
    setSectionsExpanded(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  useEffect(() => {
    loadTestInfo();
    detectTheme();
  }, []);


  const detectTheme = () => {
    // Try to detect theme from various sources
    const isDark =
      // Check for Atlassian's CSS custom properties
      getComputedStyle(document.documentElement).getPropertyValue('--ds-surface').trim() === '#1D2125' ||
      // Check for prefers-color-scheme
      window.matchMedia('(prefers-color-scheme: dark)').matches ||
      // Check for dark class on html/body
      document.documentElement.classList.contains('dark') ||
      document.body.classList.contains('dark') ||
      // Check background color as fallback
      getComputedStyle(document.body).backgroundColor === 'rgb(29, 33, 37)';

    setIsDarkTheme(isDark);

    // Listen for theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleThemeChange = (e) => setIsDarkTheme(e.matches);
    mediaQuery.addEventListener('change', handleThemeChange);

    return () => mediaQuery.removeEventListener('change', handleThemeChange);
  };

  const loadTestInfo = async () => {
    try {
      const response = await invoke('getTestInfo');
      console.log('Response from resolver:', response);

      if (response.error) {
        setError(response.error);
        if (response.notConfigured) {
          // Show configuration message
          setTestData({ notConfigured: true });
        }
      } else {
        setTestData(response);
        setInstanceUrl(response.instanceUrl);
      }
    } catch (err) {
      console.error('Error loading test info:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openTestCaseUrl = async (testCaseId, projectId) => {
    try {
      if (!instanceUrl) {
        console.error('Instance URL not configured');
        return;
      }

      // Use locale-neutral URLs - let TestPlanit middleware handle locale detection
      const url = projectId
        ? `${instanceUrl}/projects/repository/${projectId}/${testCaseId}`
        : `${instanceUrl}/test-cases/${testCaseId}`;

      console.log('Opening test case URL:', url);

      // Use Forge router.open() to open URL in new window - this is the correct way for Forge Custom UI
      try {
        await router.open(url);
        console.log('Successfully opened URL via Forge router.open()');
        return;
      } catch (routerError) {
        console.log('Forge router.open() failed, trying router.navigate():', routerError);

        // Fallback to router.navigate() which opens in same window but navigates away from Jira
        try {
          await router.navigate(url);
          console.log('Successfully navigated via Forge router.navigate()');
          return;
        } catch (navigateError) {
          console.log('Forge router.navigate() failed:', navigateError);
        }
      }

      // Final fallback - direct redirect (though this may not work due to sandbox)
      console.log('Using final fallback redirect');
      window.location.href = url;
    } catch (err) {
      console.error('Error opening test case:', err);
      if (instanceUrl) {
        // Final fallback
        const fallbackUrl = projectId
          ? `${instanceUrl}/projects/repository/${projectId}/${testCaseId}`
          : `${instanceUrl}/test-cases/${testCaseId}`;
        window.location.href = fallbackUrl;
      }
    }
  };

  const openSessionUrl = async (sessionId, projectId) => {
    try {
      if (!instanceUrl) {
        console.error('Instance URL not configured');
        return;
      }

      // Use locale-neutral URLs - let TestPlanit middleware handle locale detection
      const url = projectId
        ? `${instanceUrl}/projects/sessions/${projectId}/${sessionId}`
        : `${instanceUrl}/sessions/${sessionId}`;

      console.log('Opening session URL:', url);

      // Use Forge router.open() to open URL in new window - this is the correct way for Forge Custom UI
      try {
        await router.open(url);
        console.log('Successfully opened URL via Forge router.open()');
        return;
      } catch (routerError) {
        console.log('Forge router.open() failed, trying router.navigate():', routerError);

        // Fallback to router.navigate() which opens in same window but navigates away from Jira
        try {
          await router.navigate(url);
          console.log('Successfully navigated via Forge router.navigate()');
          return;
        } catch (navigateError) {
          console.log('Forge router.navigate() failed:', navigateError);
        }
      }

      // Final fallback - direct redirect (though this may not work due to sandbox)
      console.log('Using final fallback redirect');
      window.location.href = url;
    } catch (err) {
      console.error('Error opening session:', err);
      if (instanceUrl) {
        // Final fallback
        const fallbackUrl = projectId
          ? `${instanceUrl}/projects/sessions/${projectId}/${sessionId}`
          : `${instanceUrl}/sessions/${sessionId}`;
        window.location.href = fallbackUrl;
      }
    }
  };

  const openTestRunUrl = async (testRunId, projectId) => {
    try {
      if (!instanceUrl) {
        console.error('Instance URL not configured');
        return;
      }

      // Use locale-neutral URLs - let TestPlanit middleware handle locale detection
      const url = projectId
        ? `${instanceUrl}/projects/runs/${projectId}/${testRunId}`
        : `${instanceUrl}/test-runs/${testRunId}`;

      console.log('Opening test run URL:', url);

      // Use Forge router.open() to open URL in new window - this is the correct way for Forge Custom UI
      try {
        await router.open(url);
        console.log('Successfully opened URL via Forge router.open()');
        return;
      } catch (routerError) {
        console.log('Forge router.open() failed, trying router.navigate():', routerError);

        // Fallback to router.navigate() which opens in same window but navigates away from Jira
        try {
          await router.navigate(url);
          console.log('Successfully navigated via Forge router.navigate()');
          return;
        } catch (navigateError) {
          console.log('Forge router.navigate() failed:', navigateError);
        }
      }

      // Final fallback - direct redirect (though this may not work due to sandbox)
      console.log('Using final fallback redirect');
      window.location.href = url;
    } catch (err) {
      console.error('Error opening test run:', err);
      if (instanceUrl) {
        // Final fallback
        const fallbackUrl = projectId
          ? `${instanceUrl}/projects/runs/${projectId}/${testRunId}`
          : `${instanceUrl}/test-runs/${testRunId}`;
        window.location.href = fallbackUrl;
      }
    }
  };

  const openTestPlanIt = async () => {
    try {
      console.log('Opening TestPlanIt main site');
      const url = instanceUrl || 'https://testplanit.com';

      // Use Forge router.open() to open URL in new window - this is the correct way for Forge Custom UI
      try {
        await router.open(url);
        console.log('Successfully opened URL via Forge router.open()');
        return;
      } catch (routerError) {
        console.log('Forge router.open() failed, trying router.navigate():', routerError);

        // Fallback to router.navigate() which opens in same window but navigates away from Jira
        try {
          await router.navigate(url);
          console.log('Successfully navigated via Forge router.navigate()');
          return;
        } catch (navigateError) {
          console.log('Forge router.navigate() failed:', navigateError);
        }
      }

      // Final fallback - direct redirect (though this may not work due to sandbox)
      console.log('Using final fallback redirect');
      window.location.href = url;
    } catch (err) {
      console.error('Error opening TestPlanIt:', err);
      if (instanceUrl) {
        window.location.href = instanceUrl;
      }
    }
  };

  // Configuration UI Component (shown when not configured)
  const ConfigurationUI = () => {
    const [configUrl, setConfigUrl] = useState('');
    const [configSaving, setConfigSaving] = useState(false);
    const [configError, setConfigError] = useState(null);
    const [configTesting, setConfigTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [currentUrl, setCurrentUrl] = useState(null);
    const [configLoading, setConfigLoading] = useState(true);

    // Load current settings on mount
    useEffect(() => {
      loadCurrentSettings();
    }, []);

    const loadCurrentSettings = async () => {
      try {
        const response = await invoke('getSettings');
        console.log('Current settings:', response);
        if (response.instanceUrl) {
          setCurrentUrl(response.instanceUrl);
          setConfigUrl(response.instanceUrl);
        }
      } catch (err) {
        console.error('Error loading current settings:', err);
      } finally {
        setConfigLoading(false);
      }
    };

    const handleClearSettings = async () => {
      try {
        await invoke('clearSettings');
        setCurrentUrl(null);
        setConfigUrl('');
        setTestResult(null);
        setConfigError(null);
      } catch (err) {
        setConfigError(err.message);
      }
    };

    const handleTestConnection = async () => {
      if (!configUrl) {
        setConfigError('Please enter a URL');
        return;
      }

      setConfigTesting(true);
      setConfigError(null);
      setTestResult(null);

      try {
        const response = await invoke('testConnection', { instanceUrl: configUrl });
        setTestResult(response);
      } catch (err) {
        setTestResult({ success: false, message: err.message });
      } finally {
        setConfigTesting(false);
      }
    };

    const handleSave = async () => {
      if (!configUrl) {
        setConfigError('Please enter a URL');
        return;
      }

      setConfigSaving(true);
      setConfigError(null);

      try {
        const response = await invoke('saveSettings', { instanceUrl: configUrl });
        if (response.success) {
          // Reload test info after successful save
          setLoading(true);
          await loadTestInfo();
        } else {
          setConfigError(response.error || 'Failed to save configuration');
        }
      } catch (err) {
        setConfigError(err.message);
      } finally {
        setConfigSaving(false);
      }
    };

    return (
      <div className="p-4 testplanit-bg">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <DynamicIcon name="Settings" className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">Configure TestPlanIt</h3>
          </div>

          {error && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-xs">
              <div className="flex items-start gap-2">
                <DynamicIcon name="AlertTriangle" className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-yellow-800 font-medium">Connection Error</p>
                  <p className="text-yellow-700 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {currentUrl && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-xs">
              <div className="flex items-start gap-2">
                <DynamicIcon name="Info" className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-blue-800 font-medium">Currently configured URL:</p>
                  <p className="text-blue-700 mt-1 font-mono break-all">{currentUrl}</p>
                  <button
                    onClick={handleClearSettings}
                    className="text-blue-600 hover:text-blue-800 underline mt-2"
                  >
                    Clear and reconfigure
                  </button>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground mb-4">
            {currentUrl ? 'Update your TestPlanIt instance URL below:' : 'Enter your TestPlanIt instance URL to connect this Jira panel.'}
          </p>

          <div className="mb-3">
            <label className="block text-xs font-medium mb-2">TestPlanIt Instance URL</label>
            <input
              type="text"
              value={configUrl}
              onChange={(e) => {
                setConfigUrl(e.target.value);
                setConfigError(null);
                setTestResult(null);
              }}
              placeholder="https://demo.testplanit.com"
              disabled={configLoading}
              className="w-full px-3 py-2 border border-border rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Must be a *.testplanit.com subdomain
            </p>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              onClick={handleTestConnection}
              disabled={configTesting || !configUrl}
              className="flex items-center gap-1 px-3 py-2 border border-border rounded text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {configTesting ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <DynamicIcon name="TestTube" className="h-3 w-3" />
                  <span>Test Connection</span>
                </>
              )}
            </button>

            <button
              onClick={handleSave}
              disabled={configSaving || !configUrl}
              className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {configSaving ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <DynamicIcon name="Save" className="h-3 w-3" />
                  <span>Save & Connect</span>
                </>
              )}
            </button>
          </div>

          {testResult && (
            <div className={`rounded p-3 mb-3 text-xs ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-start gap-2">
                <DynamicIcon name={testResult.success ? 'CheckCircle' : 'XCircle'} className={`h-4 w-4 mt-0.5 ${testResult.success ? 'text-green-600' : 'text-red-600'}`} />
                <p className={testResult.success ? 'text-green-800' : 'text-red-800'}>{testResult.message}</p>
              </div>
            </div>
          )}

          {configError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs">
              <div className="flex items-start gap-2">
                <DynamicIcon name="AlertCircle" className="h-4 w-4 text-red-600 mt-0.5" />
                <p className="text-red-800">{configError}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-4 testplanit-bg">
        <div className="flex items-center gap-3 mb-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0 text-primary-900"></div>
          <span className="text-sm text-muted-foreground">Loading test information...</span>
        </div>
      </div>
    );
  }

  if (error || testData?.notConfigured) {
    // Always show configuration UI when there's an error or not configured
    // This is more user-friendly than showing a generic error message
    return <ConfigurationUI />;
  }

  const hasTestCases = testData?.testCases?.length > 0;
  const hasSessions = testData?.sessions?.length > 0;
  const hasTestRuns = testData?.testRuns?.length > 0;

  if (!hasTestCases && !hasSessions && !hasTestRuns) {
    return (
      <div className="p-4 testplanit-bg">
        <div className="bg-card rounded-lg p-6 text-center border border-border">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm text-muted-foreground mb-4">No tests linked to this issue yet</p>
          <button
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            onClick={openTestPlanIt}
          >
            Link tests in TestPlanIt
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 testplanit-bg">
      {/* Test Cases Section */}
      {hasTestCases && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('testCases')}
          >
            <DynamicIcon
              name={sectionsExpanded.testCases ? "ChevronDown" : "ChevronRight"}
              className="h-4 w-4"
            />
            Test Cases ({testData.testCases.length})
          </button>
          {sectionsExpanded.testCases && (
            <div>
              {testData.testCases.map((testCase, index) => (
                <TestCaseRow
                  key={testCase.id || index}
                  testCase={testCase}
                  onOpen={openTestCaseUrl}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Test Runs Section */}
      {hasTestRuns && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('testRuns')}
          >
            <DynamicIcon
              name={sectionsExpanded.testRuns ? "ChevronDown" : "ChevronRight"}
              className="h-4 w-4"
            />
            Test Runs ({testData.testRuns.length})
          </button>
          {sectionsExpanded.testRuns && (
            <div>
              {testData.testRuns.map((testRun, index) => (
                <TestRunRow
                  key={testRun.id || index}
                  testRun={testRun}
                  onOpen={openTestRunUrl}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sessions Section */}
      {hasSessions && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('sessions')}
          >
            <DynamicIcon
              name={sectionsExpanded.sessions ? "ChevronDown" : "ChevronRight"}
              className="h-4 w-4"
            />
            Sessions ({testData.sessions.length})
          </button>
          {sectionsExpanded.sessions && (
            <div>
              {testData.sessions.map((session, index) => (
                <SessionRow
                  key={session.id || index}
                  session={session}
                  onOpen={openSessionUrl}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="border-t border-border pt-4">
        <button
          className="text-sm text-muted-foreground hover:text-primary font-medium hover:underline transition-colors"
          onClick={openTestPlanIt}
        >
          Open TestPlanIt →
        </button>
      </div>
    </div>
  );
};

// Initialize the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}