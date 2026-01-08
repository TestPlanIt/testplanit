import { PlayCircle, ListTree, Users, Heart, Compass, Bug, TrendingUp, Shuffle } from "lucide-react";

export interface ReportType {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<any>;
  endpoint: string;
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
  },
  {
    id: "flaky-tests",
    label: tReports("reportTypes.flakyTests.label"),
    description: tReports("reportTypes.flakyTests.description"),
    icon: Shuffle,
    endpoint: "/api/report-builder/flaky-tests",
  },
];

// Cross-project report types for admin - using function to access translations
export const getCrossProjectReportTypes = (tReports: any): ReportType[] => [
  {
    id: "test-execution",
    label: tReports("crossProjectReportTypes.testExecution.label"),
    description: tReports("crossProjectReportTypes.testExecution.description"),
    icon: PlayCircle,
    endpoint: "/api/report-builder/cross-project-test-execution",
  },
  {
    id: "repository-stats",
    label: tReports("crossProjectReportTypes.repositoryStats.label"),
    description: tReports(
      "crossProjectReportTypes.repositoryStats.description"
    ),
    icon: ListTree,
    endpoint: "/api/report-builder/cross-project-repository-stats",
  },
  {
    id: "user-engagement",
    label: tReports("crossProjectReportTypes.userEngagement.label"),
    description: tReports("crossProjectReportTypes.userEngagement.description"),
    icon: Users,
    endpoint: "/api/report-builder/cross-project-user-engagement",
  },
  {
    id: "issue-tracking",
    label: tReports("crossProjectReportTypes.issueTracking.label"),
    description: tReports("crossProjectReportTypes.issueTracking.description"),
    icon: Bug,
    endpoint: "/api/report-builder/cross-project-issue-tracking",
  },
  {
    id: "automation-trends",
    label: tReports("crossProjectReportTypes.automationTrends.label"),
    description: tReports("crossProjectReportTypes.automationTrends.description"),
    icon: TrendingUp,
    endpoint: "/api/report-builder/cross-project-automation-trends",
  },
  {
    id: "flaky-tests",
    label: tReports("crossProjectReportTypes.flakyTests.label"),
    description: tReports("crossProjectReportTypes.flakyTests.description"),
    icon: Shuffle,
    endpoint: "/api/report-builder/cross-project-flaky-tests",
  },
];
