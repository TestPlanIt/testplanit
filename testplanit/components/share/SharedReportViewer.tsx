"use client";

import { StaticReportViewer } from "./StaticReportViewer";

interface SharedReportViewerProps {
  shareData: any;
  shareMode: string;
}

/**
 * Wrapper component for shared report viewing
 * This is only used for PUBLIC and PASSWORD_PROTECTED shares
 * AUTHENTICATED shares redirect to the full Reports page
 */
export function SharedReportViewer({ shareData, shareMode }: SharedReportViewerProps) {
  return <StaticReportViewer shareData={shareData} shareMode={shareMode} />;
}
