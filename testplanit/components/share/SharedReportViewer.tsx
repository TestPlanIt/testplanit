"use client";

import { StaticReportViewer } from "./StaticReportViewer";

interface SharedReportViewerProps {
  shareData: any;
  shareMode: string;
  isAuthenticatedUser?: boolean;
}

/**
 * Wrapper component for shared report viewing
 * This is only used for PUBLIC and PASSWORD_PROTECTED shares
 * AUTHENTICATED shares redirect to the full Reports page
 */
export function SharedReportViewer({ shareData, shareMode, isAuthenticatedUser = false }: SharedReportViewerProps) {
  return <StaticReportViewer shareData={shareData} shareMode={shareMode} isAuthenticatedUser={isAuthenticatedUser} />;
}
