import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
}));

const scan = {
  isScanning: false,
  isFollowing: false,
  scanError: null as string | null,
  startScan: vi.fn(),
  cancelScan: vi.fn(),
  followScan: vi.fn(),
};
vi.mock("~/hooks/useIssueScan", () => ({ useIssueScan: () => scan }));

import { ImpactScanButtons } from "./ImpactScanButtons";

const config = { id: 11, repositoryId: 3, issueScanReport: null as unknown };
const refetchConfigs = vi.fn(async () => ({ data: [config] }));

describe("ImpactScanButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scan.isScanning = false;
    scan.isFollowing = false;
    scan.scanError = null;
    scan.startScan.mockResolvedValue(undefined);
    scan.cancelScan.mockResolvedValue(undefined);
    scan.followScan.mockResolvedValue(undefined);
  });

  it("queues a recent or full scan for its own connection", () => {
    render(
      <ImpactScanButtons config={config} refetchConfigs={refetchConfigs} />
    );
    fireEvent.click(screen.getByTestId("impact-repo-scan-recent-11"));
    expect(scan.startScan).toHaveBeenLastCalledWith({
      repositoryId: 3,
      configId: 11,
      full: false,
    });
    fireEvent.click(screen.getByTestId("impact-repo-scan-full-11"));
    expect(scan.startScan).toHaveBeenLastCalledWith({
      repositoryId: 3,
      configId: 11,
      full: true,
    });
    expect(screen.queryByTestId("impact-repo-scan-cancel-11")).toBeNull();
  });

  it("disables both buttons while a scan it started is in flight", () => {
    scan.isScanning = true;
    render(
      <ImpactScanButtons config={config} refetchConfigs={refetchConfigs} />
    );
    expect(screen.getByTestId("impact-repo-scan-recent-11")).toBeDisabled();
    expect(screen.getByTestId("impact-repo-scan-full-11")).toBeDisabled();
  });

  it("offers Cancel and follows a scan already running for the connection", () => {
    const running = {
      ...config,
      issueScanReport: {
        running: true,
        startedAt: new Date().toISOString(),
        full: true,
        stage: "walk",
      },
    };
    render(
      <ImpactScanButtons config={running} refetchConfigs={refetchConfigs} />
    );
    expect(scan.followScan).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("impact-repo-scan-cancel-11"));
    expect(scan.cancelScan).toHaveBeenCalledWith({
      repositoryId: 3,
      configId: 11,
    });
  });

  it("shows the hook's error under the buttons", () => {
    scan.scanError = "boom";
    render(
      <ImpactScanButtons config={config} refetchConfigs={refetchConfigs} />
    );
    expect(screen.getByTestId("impact-repo-scan-error-11")).toHaveTextContent(
      "boom"
    );
  });
});
