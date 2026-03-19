import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Mock StaticReportViewer
vi.mock("./StaticReportViewer", () => ({
  StaticReportViewer: ({ shareData, shareMode, isAuthenticatedUser }: {
    shareData: any;
    shareMode: string;
    isAuthenticatedUser?: boolean;
  }) => (
    <div data-testid="static-report-viewer">
      <span data-testid="share-mode">{shareMode}</span>
      <span data-testid="is-authenticated-user">{String(isAuthenticatedUser)}</span>
      <span data-testid="share-data-key">{shareData?.shareKey}</span>
    </div>
  ),
}));

import { SharedReportViewer } from "./SharedReportViewer";

const sampleShareData = {
  shareKey: "abc123",
  entityType: "REPORT",
  mode: "PUBLIC",
  entityConfig: {
    reportType: "repository-stats",
    dimensions: ["user"],
    metrics: ["count"],
  },
  title: "Test Report",
};

describe("SharedReportViewer", () => {
  it("renders StaticReportViewer with shareData and shareMode props", () => {
    render(<SharedReportViewer shareData={sampleShareData} shareMode="PUBLIC" />);
    expect(screen.getByTestId("static-report-viewer")).toBeInTheDocument();
  });

  it("passes shareMode to StaticReportViewer", () => {
    render(<SharedReportViewer shareData={sampleShareData} shareMode="PUBLIC" />);
    expect(screen.getByTestId("share-mode")).toHaveTextContent("PUBLIC");
  });

  it("passes shareData to StaticReportViewer", () => {
    render(<SharedReportViewer shareData={sampleShareData} shareMode="PUBLIC" />);
    expect(screen.getByTestId("share-data-key")).toHaveTextContent("abc123");
  });

  it("passes isAuthenticatedUser=false by default", () => {
    render(<SharedReportViewer shareData={sampleShareData} shareMode="PUBLIC" />);
    expect(screen.getByTestId("is-authenticated-user")).toHaveTextContent("false");
  });

  it("passes isAuthenticatedUser=true when provided", () => {
    render(
      <SharedReportViewer
        shareData={sampleShareData}
        shareMode="PASSWORD_PROTECTED"
        isAuthenticatedUser={true}
      />
    );
    expect(screen.getByTestId("is-authenticated-user")).toHaveTextContent("true");
  });

  it("passes PASSWORD_PROTECTED shareMode correctly", () => {
    render(
      <SharedReportViewer
        shareData={sampleShareData}
        shareMode="PASSWORD_PROTECTED"
      />
    );
    expect(screen.getByTestId("share-mode")).toHaveTextContent("PASSWORD_PROTECTED");
  });
});
