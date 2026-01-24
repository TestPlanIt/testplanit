import { PlayCircle, ListTree, Users, Heart, Compass, Bug, TrendingUp, Shuffle, Activity, Link2 } from "lucide-react";

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
    id: "flaky-tests",
    label: tReports("reportTypes.flakyTests.label"),
    description: tReports("reportTypes.flakyTests.description"),
    icon: Shuffle,
    endpoint: "/api/report-builder/flaky-tests",
    isPreBuilt: true,
  },
  {
    id: "test-case-health",
    label: tReports("reportTypes.testCaseHealth.label"),
    description: tReports("reportTypes.testCaseHealth.description"),
    icon: Activity,
    endpoint: "/api/report-builder/test-case-health",
    isPreBuilt: true,
  },
  {
    id: "issue-test-coverage",
    label: tReports("reportTypes.issueTestCoverage.label"),
    description: tReports("reportTypes.issueTestCoverage.description"),
    icon: Link2,
    endpoint: "/api/report-builder/issue-test-coverage",
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
    id: "cross-project-automation-trends",
    label: tReports("crossProjectReportTypes.automationTrends.label"),
    description: tReports("crossProjectReportTypes.automationTrends.description"),
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
    icon: Activity,
    endpoint: "/api/report-builder/cross-project-test-case-health",
    isPreBuilt: true,
  },
  {
    id: "cross-project-issue-test-coverage",
    label: tReports("crossProjectReportTypes.issueTestCoverage.label"),
    description: tReports("crossProjectReportTypes.issueTestCoverage.description"),
    icon: Link2,
    endpoint: "/api/report-builder/cross-project-issue-test-coverage",
    isPreBuilt: true,
  },
];
