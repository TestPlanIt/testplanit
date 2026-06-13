import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, router, view } from '@forge/bridge';
import * as LucideIcons from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import './app.css';

// Flatten a folder list into a depth-ordered array (children nested under
// parents), mirroring the app's hierarchical FolderSelect. Native <option>
// elements can't nest, so depth drives leading indentation in the label.
const flattenFolders = (folders) => {
  const byParent = new Map();
  for (const f of folders || []) {
    const key = f.parentId == null ? 'root' : f.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const out = [];
  const walk = (key, depth) => {
    for (const f of byParent.get(key) || []) {
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk('root', 0);
  return out;
};

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


// Quantity presets — values map to the backend's generation guidance keys.
// Mirrors the in-app wizard's quantity choices (generateTestCases.addNotes.
// quantityOptions). Values map to the backend's getQuantityGuidance keys.
const QUANTITY_OPTIONS = [
  { value: 'just_one', label: 'Just one' },
  { value: 'couple', label: 'A couple (2)' },
  { value: 'few', label: 'A few (2-3)' },
  { value: 'several', label: 'Several (4-6)' },
  { value: 'many', label: 'Many (7-10)' },
  { value: 'all', label: 'Maximum' },
];

// Render a single generated field value for the preview. Steps-shaped arrays
// render as an ordered list; everything else renders as compact text.
const PreviewFieldValue = ({ name, value }) => {
  const isSteps =
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    ('step' in value[0] || 'expectedResult' in value[0]);

  if (isSteps) {
    return (
      <div className="mt-1">
        <div className="text-xs font-medium text-muted-foreground">{name}</div>
        <ol className="list-decimal ml-4 mt-1 space-y-1">
          {value.map((s, i) => (
            <li key={i} className="text-xs">
              <span>{s.step}</span>
              {s.expectedResult ? (
                <span className="text-muted-foreground">
                  {' '}
                  → {s.expectedResult}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const text = Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : String(value ?? '');

  if (!text) return null;

  return (
    <div className="mt-1">
      <span className="text-xs font-medium text-muted-foreground">{name}: </span>
      <span className="text-xs">{text}</span>
    </div>
  );
};

// A single generated case in the preview list: checkbox + name + expandable
// field values.
const PreviewCaseRow = ({ testCase, checked, onToggle }) => {
  const [expanded, setExpanded] = useState(false);
  const fieldEntries = Object.entries(testCase.fieldValues || {});

  return (
    <div className="testplanit-card border rounded-md mb-1">
      <div className="flex items-center gap-2 p-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0"
        />
        <button
          className="text-sm font-medium flex-1 truncate text-left"
          onClick={() => setExpanded(!expanded)}
          title={testCase.name}
        >
          {testCase.name}
        </button>
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded"
          onClick={() => setExpanded(!expanded)}
        >
          <DynamicIcon
            name={expanded ? 'ChevronDown' : 'ChevronRight'}
            className="h-4 w-4"
          />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-muted/30 p-2">
          {fieldEntries.length > 0 ? (
            fieldEntries.map(([name, value]) => (
              <PreviewFieldValue key={name} name={name} value={value} />
            ))
          ) : (
            <div className="text-xs text-muted-foreground">No field values</div>
          )}
          {testCase.tags && testCase.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {testCase.tags.map((tag, i) => (
                <span
                  key={i}
                  className="text-xs testplanit-muted-bg testplanit-text-muted px-2 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Generate Test Cases flow — configure → generating → preview → done.
const GenerateTestCasesFlow = ({ onClose, onImported, initialContext }) => {
  // Seed from the context the panel already fetched for the eligibility gate,
  // so opening the flow doesn't re-hit the backend on mount.
  const initialTemplates = initialContext?.templates || [];
  const initialTemplate =
    initialTemplates.find((t) => t.isDefault) || initialTemplates[0];

  const [step, setStep] = useState('configure'); // configure | generating | preview | saving | done
  const [loadingContext, setLoadingContext] = useState(!initialContext);
  const [error, setError] = useState(null);

  const [projects, setProjects] = useState(initialContext?.projects || []);
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialContext?.selectedProjectId ?? null
  );
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    initialTemplate ? initialTemplate.id : null
  );
  const [readiness, setReadiness] = useState(initialContext?.readiness || null);
  const [folders, setFolders] = useState(initialContext?.folders || []);
  const [selectedFolderId, setSelectedFolderId] = useState(
    initialContext?.suggestedFolderId ?? null
  );
  const [issueKey, setIssueKey] = useState(initialContext?.issueKey || null);
  // 'new' = create a top-level folder named after the ticket; 'existing' = pick
  // one. Default to the suggested existing folder when the issue already has
  // linked cases, otherwise to creating a new ticket-named folder.
  const [folderMode, setFolderMode] = useState(
    initialContext?.suggestedFolderId ? 'existing' : 'new'
  );

  const [quantity, setQuantity] = useState('several');
  const [autoGenerateTags, setAutoGenerateTags] = useState(true);
  const [userNotes, setUserNotes] = useState('');

  const [generated, setGenerated] = useState([]);
  const [selectedCases, setSelectedCases] = useState(new Set());
  const [issueMeta, setIssueMeta] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    if (!initialContext) loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadContext = async (projectId) => {
    setLoadingContext(true);
    setError(null);
    try {
      const res = await invoke(
        'getGenerationContext',
        projectId ? { projectId } : {}
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      setProjects(res.projects || []);
      setSelectedProjectId(res.selectedProjectId ?? null);
      setTemplates(res.templates || []);
      setReadiness(res.readiness || null);
      setFolders(res.folders || []);
      setSelectedFolderId(res.suggestedFolderId ?? null);
      setIssueKey(res.issueKey || null);
      setFolderMode(res.suggestedFolderId ? 'existing' : 'new');
      const defaultTemplate =
        (res.templates || []).find((t) => t.isDefault) ||
        (res.templates || [])[0];
      setSelectedTemplateId(defaultTemplate ? defaultTemplate.id : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingContext(false);
    }
  };

  const handleProjectChange = (id) => {
    const projectId = Number(id);
    setSelectedProjectId(projectId);
    loadContext(projectId);
  };

  const readinessIssue = !readiness
    ? null
    : !readiness.hasActiveLlm
      ? 'No AI provider is configured for this project. Connect one in TestPlanIt under Admin → Integrations → AI.'
      : !readiness.hasRepository
        ? 'This project has no test repository yet.'
        : !readiness.hasDefaultWorkflow
          ? 'This project has no default workflow state for test cases.'
          : null;

  const canGenerate =
    selectedProjectId &&
    selectedTemplateId &&
    readiness &&
    readiness.hasActiveLlm &&
    readiness.hasRepository &&
    readiness.hasDefaultWorkflow &&
    // Either create a new ticket-named folder, or pick an existing one.
    (folderMode === 'new' || !!selectedFolderId);

  const handleGenerate = async () => {
    setStep('generating');
    setError(null);
    setWarnings([]);
    setGenerated([]);
    setSelectedCases(new Set());
    try {
      // Forge resolvers die at 25s, so we stream generation directly from the
      // browser: mint a short-lived token via the resolver, then fetch the
      // streaming endpoint (a browser fetch isn't bound by the function limit).
      const tokenRes = await invoke('getGenerateToken', {
        projectId: selectedProjectId,
      });
      if (tokenRes.error) {
        setError(tokenRes.error);
        setStep('configure');
        return;
      }
      const { token, instanceUrl } = tokenRes;

      const response = await fetch(
        `${instanceUrl}/api/integrations/jira/generate-stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forge-Token': token,
          },
          body: JSON.stringify({
            templateId: selectedTemplateId,
            quantity,
            autoGenerateTags,
            userNotes: userNotes.trim() || undefined,
            folderId: folderMode === 'existing' ? selectedFolderId : undefined,
          }),
        }
      );

      if (!response.ok || !response.body) {
        let message = `Generation failed (${response.status})`;
        try {
          const j = await response.json();
          if (j.error) message = j.error;
        } catch {
          // non-JSON error body — keep the status message
        }
        setError(message);
        setStep('configure');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collected = [];
      let streamError = null;
      let doneIssue = null;
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let evt;
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === 'case' && evt.testCase) {
            collected.push(evt.testCase);
            setGenerated((prev) => [...prev, evt.testCase]);
            setSelectedCases((prev) => {
              const next = new Set(prev);
              next.add(evt.testCase.id);
              return next;
            });
          } else if (evt.type === 'error') {
            streamError = evt.message || 'Generation failed';
          } else if (evt.type === 'done') {
            doneIssue = evt.issue || null;
            finished = true;
          }
        }
      }

      if (streamError) {
        setError(streamError);
        setStep('configure');
        return;
      }
      if (collected.length === 0) {
        setError('No test cases were generated.');
        setStep('configure');
        return;
      }
      setIssueMeta(doneIssue);
      setStep('preview');
    } catch (err) {
      setError(err.message);
      setStep('configure');
    }
  };

  const toggleCase = (id) => {
    setSelectedCases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    const toImport = generated.filter((tc) => selectedCases.has(tc.id));
    if (toImport.length === 0) return;
    setStep('saving');
    setError(null);
    try {
      const res = await invoke('importTestCases', {
        projectId: selectedProjectId,
        templateId: selectedTemplateId,
        issueTitle: issueMeta?.title,
        autoGenerateTags,
        testCases: toImport,
        folderId: folderMode === 'existing' ? selectedFolderId : undefined,
        newFolderName:
          folderMode === 'new' ? issueKey || 'Generated from Jira' : undefined,
      });
      if (res.error) {
        setError(res.error);
        setStep('preview');
        return;
      }
      if (res.status === 'error') {
        setError(res.message || 'Import failed');
        setStep('preview');
        return;
      }
      setImportResult(res);
      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('preview');
    }
  };

  const selectedCount = selectedCases.size;

  return (
    <div className="p-4 testplanit-bg">
      <div className="flex items-center gap-2 mb-3">
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded"
          onClick={onClose}
          title="Back"
        >
          <DynamicIcon name="ArrowLeft" className="h-4 w-4" />
        </button>
        <DynamicIcon name="Sparkles" className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold">Generate Test Cases</h3>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-3 text-xs">
          <div className="flex items-start gap-2">
            <DynamicIcon
              name="AlertCircle"
              className="h-4 w-4 text-red-600 mt-0.5 shrink-0"
            />
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* CONFIGURE */}
      {step === 'configure' &&
        (loadingContext ? (
          <div className="flex items-center gap-3 py-4">
            <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">
            No TestPlanIt projects are connected to this Jira integration, or you
            don't have access to them.
          </div>
        ) : (
          <div>
            {projects.length > 1 && (
              <div className="mb-3">
                <label className="block text-xs font-medium mb-2">Project</label>
                <select
                  value={selectedProjectId ?? ''}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">Template</label>
              <select
                value={selectedTemplateId ?? ''}
                onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
                disabled={templates.length === 0}
                className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground disabled:opacity-50"
              >
                {templates.length === 0 && <option value="">No templates</option>}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">
                Destination folder
              </label>
              <div className="space-y-2 mb-2">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="folderMode"
                    checked={folderMode === 'new'}
                    onChange={() => setFolderMode('new')}
                    className="h-3.5 w-3.5"
                  />
                  <span>
                    Create new folder{issueKey ? ` “${issueKey}”` : ''}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="folderMode"
                    checked={folderMode === 'existing'}
                    onChange={() => setFolderMode('existing')}
                    disabled={folders.length === 0}
                    className="h-3.5 w-3.5"
                  />
                  <span
                    className={
                      folders.length === 0 ? 'text-muted-foreground' : ''
                    }
                  >
                    Use an existing folder
                    {folders.length === 0 ? ' (none yet)' : ''}
                  </span>
                </label>
              </div>
              {folderMode === 'existing' && folders.length > 0 && (
                <select
                  value={selectedFolderId ?? ''}
                  onChange={(e) =>
                    setSelectedFolderId(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
                >
                <option value="">Select a folder…</option>
                {flattenFolders(folders).map((f) => (
                  <option key={f.id} value={f.id}>
                    {'   '.repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
                </select>
              )}
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">
                How many cases?
              </label>
              <select
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
              >
                {QUANTITY_OPTIONS.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">
                Additional guidance (optional)
              </label>
              <textarea
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                rows={3}
                placeholder="e.g. focus on edge cases and error handling"
                className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
              />
            </div>

            <label className="flex items-center gap-2 mb-3 text-xs">
              <input
                type="checkbox"
                checked={autoGenerateTags}
                onChange={(e) => setAutoGenerateTags(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Auto-generate tags</span>
            </label>

            {readinessIssue && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-3 text-xs">
                <div className="flex items-start gap-2">
                  <DynamicIcon
                    name="AlertTriangle"
                    className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0"
                  />
                  <p className="text-yellow-800">{readinessIssue}</p>
                </div>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="flex items-center justify-center gap-1 w-full px-3 py-2 bg-brand text-white rounded text-xs font-medium hover:bg-brand-hover active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
            >
              <DynamicIcon name="Sparkles" className="h-3 w-3" />
              <span>Generate</span>
            </button>
          </div>
        ))}

      {/* GENERATING (cases stream in live) */}
      {step === 'generating' && (
        <div className="py-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
            <span className="text-sm text-muted-foreground">
              Generating test cases
              {generated.length > 0 ? ` (${generated.length} so far)` : ''}…
            </span>
          </div>
          {generated.map((tc) => (
            <div
              key={tc.id}
              className="testplanit-card border rounded-md mb-1 p-2 text-sm font-medium truncate"
              title={tc.name}
            >
              {tc.name}
            </div>
          ))}
        </div>
      )}

      {/* PREVIEW */}
      {step === 'preview' && (
        <div>
          {warnings.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-xs text-yellow-800">
              {warnings.length} warning(s) during generation.
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2">
            Review and select the cases to save.
          </p>
          <div className="mb-3">
            {generated.map((tc) => (
              <PreviewCaseRow
                key={tc.id}
                testCase={tc}
                checked={selectedCases.has(tc.id)}
                onToggle={() => toggleCase(tc.id)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStep('configure')}
              className="flex items-center gap-1 px-3 py-2 border border-testplanit-border rounded text-xs font-medium hover:bg-violet-50 hover:text-violet-700 hover:border-violet-300 dark:hover:bg-violet-900 dark:hover:text-violet-100 dark:hover:border-violet-700 active:scale-95 transition-all duration-150"
            >
              <DynamicIcon name="ChevronLeft" className="h-3 w-3" />
              <span>Back</span>
            </button>
            <button
              onClick={handleSave}
              disabled={selectedCount === 0}
              className="flex items-center justify-center gap-1 flex-1 px-3 py-2 bg-brand text-white rounded text-xs font-medium hover:bg-brand-hover active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
            >
              <DynamicIcon name="Save" className="h-3 w-3" />
              <span>
                Save {selectedCount} case{selectedCount === 1 ? '' : 's'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* SAVING */}
      {step === 'saving' && (
        <div className="flex items-center gap-3 py-6">
          <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
          <span className="text-sm text-muted-foreground">Saving…</span>
        </div>
      )}

      {/* DONE */}
      {step === 'done' && importResult && (
        <div>
          <div className="bg-green-50 border border-green-200 rounded p-3 mb-3 text-xs">
            <div className="flex items-start gap-2">
              <DynamicIcon
                name="CheckCircle"
                className="h-4 w-4 text-green-600 mt-0.5 shrink-0"
              />
              <p className="text-green-800">
                Imported {importResult.importedCount} test case
                {importResult.importedCount === 1 ? '' : 's'} and linked them to
                this issue.
              </p>
            </div>
          </div>
          {importResult.errors && importResult.errors.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-xs text-yellow-800">
              {importResult.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => onImported()}
            className="w-full px-3 py-2 bg-brand text-white rounded text-xs font-medium hover:bg-brand-hover active:scale-95 transition-all duration-150"
          >
            Done
          </button>
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
  const [showGenerate, setShowGenerate] = useState(false);
  // Eligibility gate for the Generate button (app parity): the button only
  // shows when the mapped user can actually generate into a ready project.
  const [generationContext, setGenerationContext] = useState(null);
  const [canGenerate, setCanGenerate] = useState(false);

  const handleImported = () => {
    setShowGenerate(false);
    setLoading(true);
    loadTestInfo();
  };

  const loadGenerationEligibility = async () => {
    try {
      const ctx = await invoke('getGenerationContext');
      if (ctx.error) {
        setCanGenerate(false);
        return;
      }
      setGenerationContext(ctx);
      const ready =
        ctx.readiness &&
        ctx.readiness.hasActiveLlm &&
        ctx.readiness.hasRepository &&
        ctx.readiness.hasDefaultWorkflow;
      setCanGenerate(Boolean(ctx.selectedProjectId) && Boolean(ready));
    } catch {
      setCanGenerate(false);
    }
  };

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
    loadGenerationEligibility();
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
    const [configApiKey, setConfigApiKey] = useState('');
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
        if (response.apiKey) {
          setConfigApiKey(response.apiKey);
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
        setConfigApiKey('');
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
      if (!configApiKey) {
        setConfigError('Please enter an API key');
        return;
      }

      setConfigTesting(true);
      setConfigError(null);
      setTestResult(null);

      try {
        const response = await invoke('testConnection', { instanceUrl: configUrl, apiKey: configApiKey });
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
      if (!configApiKey) {
        setConfigError('Please enter an API key');
        return;
      }

      setConfigSaving(true);
      setConfigError(null);

      try {
        const response = await invoke('saveSettings', { instanceUrl: configUrl, apiKey: configApiKey.trim() });
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
              className="w-full px-3 py-2 border border-border rounded text-xs focus:outline-hidden focus:ring-2 focus:ring-primary bg-background text-foreground disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Must be a *.testplanit.com subdomain
            </p>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium mb-2">Forge API Key</label>
            <input
              type="password"
              value={configApiKey}
              onChange={(e) => {
                setConfigApiKey(e.target.value);
                setConfigError(null);
                setTestResult(null);
              }}
              placeholder="Enter your Forge integration API key"
              disabled={configLoading}
              className="w-full px-3 py-2 border border-border rounded text-xs focus:outline-hidden focus:ring-2 focus:ring-primary bg-background text-foreground disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Generate in TestPlanIt: Admin &gt; Integrations &gt; Jira &gt; Forge API Key
            </p>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              onClick={handleTestConnection}
              disabled={configTesting || !configUrl || !configApiKey}
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
              disabled={configSaving || !configUrl || !configApiKey}
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

  if (showGenerate) {
    return (
      <GenerateTestCasesFlow
        onClose={() => setShowGenerate(false)}
        onImported={handleImported}
        initialContext={generationContext}
      />
    );
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
          <div className="flex flex-col items-center gap-2">
            {canGenerate && (
              <button
                className="flex items-center justify-center gap-1 bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm hover:bg-brand-hover hover:shadow-md active:scale-95 transition-all duration-150"
                onClick={() => setShowGenerate(true)}
              >
                <DynamicIcon name="Sparkles" className="h-4 w-4" />
                Generate Test Cases
              </button>
            )}
            <button
              className="text-sm text-muted-foreground hover:text-primary font-medium hover:underline transition-colors"
              onClick={openTestPlanIt}
            >
              Link tests in TestPlanIt
            </button>
          </div>
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
      <div className="border-t border-border pt-4 flex items-center justify-between gap-2">
        <button
          className="text-sm text-muted-foreground hover:text-primary font-medium hover:underline transition-colors"
          onClick={openTestPlanIt}
        >
          Open TestPlanIt →
        </button>
        {canGenerate && (
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-brand text-white hover:bg-brand-hover active:scale-95 transition-all duration-150"
            onClick={() => setShowGenerate(true)}
          >
            <DynamicIcon name="Sparkles" className="h-3 w-3" />
            Generate Test Cases
          </button>
        )}
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