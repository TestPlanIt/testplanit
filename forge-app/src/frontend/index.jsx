import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Button, Box, Spinner, Heading, xcss, Tag, Stack } from '@forge/react';
import { invoke } from '@forge/bridge';

// Professional design token-based styles using xcss
const containerStyles = xcss({
  padding: 'space.200',
  backgroundColor: 'elevation.surface',
});

const sectionHeaderStyles = xcss({
  marginTop: 'space.300',
  marginBottom: 'space.150',
});

const testItemCardStyles = xcss({
  padding: 'space.150',
  backgroundColor: 'elevation.surface.raised',
  borderColor: 'color.border',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius',
  marginBottom: 'space.100',
  ':hover': {
    backgroundColor: 'elevation.surface.hovered',
    borderColor: 'color.border.selected',
  },
});

const compactRowStyles = xcss({
  padding: 'space.100',
  backgroundColor: 'elevation.surface.raised',
  borderColor: 'color.border.subtle',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderRadius: 'border.radius',
  marginBottom: 'space.075',
  ':hover': {
    backgroundColor: 'elevation.surface.hovered',
    borderColor: 'color.border.selected',
  },
});

const linkTextStyles = xcss({
  color: 'color.link',
  ':hover': {
    color: 'color.link.pressed',
  },
});

const emptyStateStyles = xcss({
  padding: 'space.600',
  backgroundColor: 'elevation.surface.sunken',
  borderRadius: 'border.radius',
});

const footerStyles = xcss({
  padding: 'space.150',
  borderTopColor: 'color.border',
  borderTopWidth: 'border.width',
  borderTopStyle: 'solid',
});

const App = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testData, setTestData] = useState(null);
  const [issueKey, setIssueKey] = useState('');

  useEffect(() => {
    loadTestInfo();
  }, []);

  const loadTestInfo = async () => {
    try {
      const response = await invoke('getTestInfo');
      console.log('Response from resolver:', response);
      console.log('Test cases:', response.testCases);
      console.log('Test runs:', response.testRuns);
      
      if (response.error) {
        setError(response.error);
      } else {
        setIssueKey(response.issueKey || 'Unknown');
        setTestData(response);
      }
    } catch (err) {
      console.error('Error loading test info:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openTestPlanIt = async () => {
    try {
      await invoke('openUrl', { url: 'https://dev.testplanit.com' });
    } catch (err) {
      console.error('Error opening TestPlanIt:', err);
      window.location.href = 'https://dev.testplanit.com';
    }
  };

  const openTestCaseUrl = async (testCaseId, projectId) => {
    try {
      // If no projectId provided, try to navigate to the test case directly
      const url = projectId 
        ? `https://dev.testplanit.com/projects/repository/${projectId}/${testCaseId}`
        : `https://dev.testplanit.com/test-cases/${testCaseId}`;
      console.log('Opening test case URL:', url);
      await invoke('openUrl', { url });
    } catch (err) {
      console.error('Error opening test case:', err);
      const fallbackUrl = projectId 
        ? `https://dev.testplanit.com/projects/repository/${projectId}/${testCaseId}`
        : `https://dev.testplanit.com/test-cases/${testCaseId}`;
      window.location.href = fallbackUrl;
    }
  };

  const openTestRunUrl = async (testRunId, projectId) => {
    try {
      const url = projectId 
        ? `https://dev.testplanit.com/projects/runs/${projectId}/${testRunId}`
        : `https://dev.testplanit.com/test-runs/${testRunId}`;
      console.log('Opening test run URL:', url);
      await invoke('openUrl', { url });
    } catch (err) {
      console.error('Error opening test run:', err);
      const fallbackUrl = projectId 
        ? `https://dev.testplanit.com/projects/runs/${projectId}/${testRunId}`
        : `https://dev.testplanit.com/test-runs/${testRunId}`;
      window.location.href = fallbackUrl;
    }
  };

  const getStatusColor = (status) => {
    const statusLower = status?.toLowerCase() || '';
    if (statusLower.includes('pass') || statusLower === 'active') return 'green';
    if (statusLower.includes('fail') || statusLower.includes('error')) return 'red';
    if (statusLower.includes('block')) return 'grey';
    if (statusLower.includes('pending') || statusLower.includes('draft') || statusLower.includes('progress')) return 'blue';
    return 'grey';
  };

  const getTestCaseIcon = (source, isDeleted) => {
    if (isDeleted) return '🗑️';
    if (source === 'JUNIT') return '⚙️';
    return '📄';
  };

  if (loading) {
    return (
      <Box xcss={containerStyles}>
        <Heading size="medium">🚀 TestPlanIt v3.8.0</Heading>
        <Stack direction="horizontal" alignItems="center" space="space.100">
          <Spinner size="small" />
          <Text size="small" color="color.text.subtle">Loading test information...</Text>
        </Stack>
      </Box>
    );
  }

  if (error) {
    return (
      <Box xcss={containerStyles}>
        <Heading size="medium">🚀 TestPlanIt v3.8.0</Heading>
        <Text size="small" color="color.text.danger">Error: {error}</Text>
        <Button size="small" appearance="primary" onClick={openTestPlanIt}>
          Open TestPlanIt
        </Button>
      </Box>
    );
  }

  const hasTestCases = testData?.testCases?.length > 0;
  const hasTestRuns = testData?.testRuns?.length > 0;

  if (!hasTestCases && !hasTestRuns) {
    return (
      <Box xcss={containerStyles}>
        <Heading size="medium">🚀 TestPlanIt v3.8.0</Heading>
        <Box xcss={emptyStateStyles}>
          <Text size="small" color="color.text.subtle">No tests linked to this issue yet</Text>
          <Button size="small" appearance="primary" onClick={openTestPlanIt}>
            Link tests in TestPlanIt
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box xcss={containerStyles}>
      <Heading size="medium" color="color.text">TestPlanIt</Heading>
      <Text size="small" color="color.text.subtle">Linked test cases and runs</Text>

      {hasTestCases && (
        <Box xcss={sectionHeaderStyles}>
          <Text size="small" weight="bold" color="color.text.subtle">LINKED FROM TEST CASES ({testData.testCases.length})</Text>
          {testData.testCases.map((testCase, index) => (
            <Box key={testCase.id || index} xcss={compactRowStyles}>
              <Stack direction="horizontal" alignItems="center" justifyContent="space-between">
                <Stack direction="horizontal" alignItems="center" space="space.100">
                  <Text size="small">{getTestCaseIcon(testCase.source, testCase.isDeleted)}</Text>
                  <Text size="small" weight="medium" xcss={linkTextStyles}>{testCase.name}</Text>
                  <Tag text={testCase.status} color={getStatusColor(testCase.status)} />
                  {testCase.lastResult && (
                    <Tag text={testCase.lastResult} color={getStatusColor(testCase.lastResult)} />
                  )}
                </Stack>
                
                <Button 
                  size="small" 
                  appearance="subtle" 
                  onClick={() => {
                    console.log('Test case clicked:', testCase);
                    openTestCaseUrl(testCase.id, testCase.projectId);
                  }}
                >
                  More ›
                </Button>
              </Stack>
            </Box>
          ))}
        </Box>
      )}

      {hasTestRuns && (
        <Box xcss={sectionHeaderStyles}>
          <Text size="small" weight="bold" color="color.text.subtle">LINKED FROM RUNS ({testData.testRuns.length})</Text>
          {testData.testRuns.map((run, index) => {
            const passRate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
            
            return (
              <Box key={run.id || index} xcss={compactRowStyles}>
                <Stack direction="horizontal" alignItems="center" justifyContent="space-between">
                  <Stack direction="horizontal" alignItems="center" space="space.100">
                    <Text size="small">🏃</Text>
                    <Text size="small" weight="medium" xcss={linkTextStyles}>{run.name}</Text>
                    <Text size="small" color="color.text.subtle" weight="medium">{passRate}%</Text>
                    <Tag text={run.status} color={getStatusColor(run.status)} />
                  </Stack>
                  
                  <Button 
                    size="small" 
                    appearance="subtle" 
                    onClick={() => {
                      console.log('Test run clicked:', run);
                      openTestRunUrl(run.id, run.projectId);
                    }}
                  >
                    More ›
                  </Button>
                </Stack>
              </Box>
            );
          })}
        </Box>
      )}

      <Box xcss={footerStyles}>
        <Button size="small" appearance="link" onClick={openTestPlanIt}>
          Open TestPlanIt →
        </Button>
      </Box>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);