import {
  HeartPulse,
  Bug,
  Compass,
  Flag,
  Grid3x3,
  Heart,
  ListTree,
  PlayCircle,
  ScrollText,
  Shuffle,
  Bot,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

export interface ReportType {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<any>;
  endpoint: string;
  /** Pre-built reports have fixed configurations and don't require dimension/metric selection */
  isPreBuilt?: boolean;
}

// Project-level report types - using function to access translations
export const getProjectReportTypes = (tReports: any): ReportType[] => [
  {
    id: "automation-candidates",
    label: tReports("reportTypes.automationCandidates.label"),
    description: tReports("reportTypes.automationCandidates.description"),
    icon: Bot,
    // Snapshot-style LLM report — rendered by AutomationCandidatesReportPreset
    // via an early-return in ReportRenderer (mirrors iteration-matrix). The
    // endpoint here is unused by the standard report-builder POST flow;
    // generation goes through a streaming POST owned by the preset.
    endpoint: "/api/reports/automation-candidates",
    isPreBuilt: true,
  },
  {
    id: "test-execution",
    label: tReports("reportTypes.testExecution.label"),
    description: tReports("reportTypes.testExecution.description"),
    icon: PlayCircle,
    endpoint: "/api/report-builder/test-execution",
  },
  {
    id: "repository-stats",
    label: tReports("reportTypes.repositoryStats.label"),
    description: tReports("reportTypes.repositoryStats.description"),
    icon: ListTree,
    endpoint: "/api/report-builder/repository-stats",
  },
  {
    id: "user-engagement",
    label: tReports("reportTypes.userEngagement.label"),
    description: tReports("reportTypes.userEngagement.description"),
    icon: Users,
    endpoint: "/api/report-builder/user-engagement",
  },
  {
    id: "project-health",
    label: tReports("reportTypes.projectHealth.label"),
    description: tReports("reportTypes.projectHealth.description"),
    icon: Heart,
    endpoint: "/api/report-builder/project-health",
  },
  {
    id: "milestone-readiness",
    label: tReports("reportTypes.milestoneReadiness.label"),
    description: tReports("reportTypes.milestoneReadiness.description"),
    icon: Flag,
    endpoint: "/api/report-builder/milestone-readiness",
  },
  {
    id: "session-analysis",
    label: tReports("reportTypes.sessionAnalysis.label"),
    description: tReports("reportTypes.sessionAnalysis.description"),
    icon: Compass,
    endpoint: "/api/report-builder/session-analysis",
  },
  {
    id: "issue-tracking",
    label: tReports("reportTypes.issueTracking.label"),
    description: tReports("reportTypes.issueTracking.description"),
    icon: Bug,
    endpoint: "/api/report-builder/issue-tracking",
  },
  {
    id: "automation-trends",
    label: tReports("reportTypes.automationTrends.label"),
    description: tReports("reportTypes.automationTrends.description"),
    icon: TrendingUp,
    endpoint: "/api/report-builder/automation-trends",
    isPreBuilt: true,
  },
  {
    id: "execution-log",
    label: tReports("reportTypes.executionLog.label"),
    description: tReports("reportTypes.executionLog.description"),
    icon: ScrollText,
    endpoint: "/api/report-builder/execution-log",
    isPreBuilt: true,
  },
  {
    id: "flaky-tests",
    label: tReports("reportTypes.flakyTests.label"),
    description: tReports("reportTypes.flakyTests.description"),
    icon: Shuffle,
    endpoint: "/api/report-builder/flaky-tests",
    isPreBuilt: true,
  },
  {
    id: "issue-test-coverage",
    label: tReports("reportTypes.issueTestCoverage.label"),
    description: tReports("reportTypes.issueTestCoverage.description"),
    icon: Bug,
    endpoint: "/api/report-builder/issue-test-coverage",
    isPreBuilt: true,
  },
  {
    id: "requirement-coverage-gaps",
    label: tReports("reportTypes.requirementCoverageGaps.label"),
    description: tReports("reportTypes.requirementCoverageGaps.description"),
    icon: Flag,
    endpoint: "/api/report-builder/requirement-coverage-gaps",
    isPreBuilt: true,
  },
  {
    id: "requirement-traceability",
    label: tReports("reportTypes.requirementTraceability.label"),
    description: tReports("reportTypes.requirementTraceability.description"),
    icon: Grid3x3,
    endpoint: "/api/report-builder/requirement-traceability",
    isPreBuilt: true,
  },
  {
    id: "iteration-matrix",
    label: tReports("reportTypes.iterationMatrix.label"),
    description: tReports("reportTypes.iterationMatrix.description"),
    icon: Grid3x3,
    endpoint: "/api/report-builder/iteration-matrix",
    isPreBuilt: true,
  },
  {
    id: "test-case-health",
    label: tReports("reportTypes.testCaseHealth.label"),
    description: tReports("reportTypes.testCaseHealth.description"),
    icon: HeartPulse,
    endpoint: "/api/report-builder/test-case-health",
    isPreBuilt: true,
  },
];

// Cross-project report types for admin - using function to access translations
export const getCrossProjectReportTypes = (tReports: any): ReportType[] => [
  {
    id: "cross-project-test-execution",
    label: tReports("crossProjectReportTypes.testExecution.label"),
    description: tReports("crossProjectReportTypes.testExecution.description"),
    icon: PlayCircle,
    endpoint: "/api/report-builder/cross-project-test-execution",
  },
  {
    id: "cross-project-repository-stats",
    label: tReports("crossProjectReportTypes.repositoryStats.label"),
    description: tReports(
      "crossProjectReportTypes.repositoryStats.description"
    ),
    icon: ListTree,
    endpoint: "/api/report-builder/cross-project-repository-stats",
  },
  {
    id: "cross-project-user-engagement",
    label: tReports("crossProjectReportTypes.userEngagement.label"),
    description: tReports("crossProjectReportTypes.userEngagement.description"),
    icon: Users,
    endpoint: "/api/report-builder/cross-project-user-engagement",
  },
  {
    id: "cross-project-issue-tracking",
    label: tReports("crossProjectReportTypes.issueTracking.label"),
    description: tReports("crossProjectReportTypes.issueTracking.description"),
    icon: Bug,
    endpoint: "/api/report-builder/cross-project-issue-tracking",
  },
  {
    id: "cross-project-llm-usage",
    label: tReports("crossProjectReportTypes.llmUsage.label"),
    description: tReports("crossProjectReportTypes.llmUsage.description"),
    icon: Sparkles,
    endpoint: "/api/report-builder/cross-project-llm-usage",
  },
  {
    id: "cross-project-automation-trends",
    label: tReports("crossProjectReportTypes.automationTrends.label"),
    description: tReports(
      "crossProjectReportTypes.automationTrends.description"
    ),
    icon: TrendingUp,
    endpoint: "/api/report-builder/cross-project-automation-trends",
    isPreBuilt: true,
  },
  {
    id: "cross-project-flaky-tests",
    label: tReports("crossProjectReportTypes.flakyTests.label"),
    description: tReports("crossProjectReportTypes.flakyTests.description"),
    icon: Shuffle,
    endpoint: "/api/report-builder/cross-project-flaky-tests",
    isPreBuilt: true,
  },
  {
    id: "cross-project-test-case-health",
    label: tReports("crossProjectReportTypes.testCaseHealth.label"),
    description: tReports("crossProjectReportTypes.testCaseHealth.description"),
    icon: HeartPulse,
    endpoint: "/api/report-builder/cross-project-test-case-health",
    isPreBuilt: true,
  },
  {
    id: "cross-project-issue-test-coverage",
    label: tReports("crossProjectReportTypes.issueTestCoverage.label"),
    description: tReports(
      "crossProjectReportTypes.issueTestCoverage.description"
    ),
    icon: Bug,
    endpoint: "/api/report-builder/cross-project-issue-test-coverage",
    isPreBuilt: true,
  },
  {
    id: "cross-project-execution-log",
    label: tReports("crossProjectReportTypes.executionLog.label"),
    description: tReports("crossProjectReportTypes.executionLog.description"),
    icon: ScrollText,
    endpoint: "/api/report-builder/cross-project-execution-log",
    isPreBuilt: true,
  },
];
