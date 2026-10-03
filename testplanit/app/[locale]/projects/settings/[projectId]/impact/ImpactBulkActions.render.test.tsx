import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace ? `${namespace}.` : ""}${key}${values ? JSON.stringify(values) : ""}`,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: any) =>
    open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, onClick, ...props }: any) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: any) => (
    <button type="button">{children}</button>
  ),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
}));
const { toast } = vi.hoisted(() => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));

import { ImpactBulkActions } from "./ImpactBulkActions";

const configs = [
  {
    id: 11,
    repositoryId: 3,
    issueScanReport: null as unknown,
    stalePinReport: null as unknown,
    repository: { name: "acme/app" },
  },
  {
    id: 12,
    repositoryId: 4,
    issueScanReport: null as unknown,
    stalePinReport: null as unknown,
    repository: { name: "acme/api" },
  },
];

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function requests(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.map(([url, init]) => ({
    url,
    body: JSON.parse((init as RequestInit).body as string),
  }));
}

describe("ImpactBulkActions", () => {
  const fetchMock = vi.fn();
  const onChanged = vi.fn(async (): Promise<unknown> => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues a recent-commit scan on every connection and reloads", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queued: true }));
    render(
      <ImpactBulkActions
        configs={configs}
        staleByConfig={new Map()}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-bulk-scanRecent"));
    await flush();

    expect(requests(fetchMock)).toEqual([
      {
        url: "/api/code-repositories/3/scan-issues",
        body: { projectConfigId: 11, full: false },
      },
      {
        url: "/api/code-repositories/4/scan-issues",
        body: { projectConfigId: 12, full: false },
      },
    ]);
    expect(toast.info).toHaveBeenCalledWith(
      'projects.settings.impact.bulk.queued{"count":2,"skipped":0}'
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("skips a connection whose scan is already queued", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queued: true }));
    render(
      <ImpactBulkActions
        configs={[
          { ...configs[0], issueScanReport: { queued: true, full: true } },
          configs[1],
        ]}
        staleByConfig={new Map()}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-bulk-scanRecent"));
    await flush();

    expect(requests(fetchMock).map((r) => r.body.projectConfigId)).toEqual([
      12,
    ]);
    expect(toast.info).toHaveBeenCalledWith(
      'projects.settings.impact.bulk.queued{"count":1,"skipped":1}'
    );
  });

  it("asks before scanning full history, then queues it everywhere", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queued: true }));
    render(
      <ImpactBulkActions
        configs={configs}
        staleByConfig={new Map()}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-bulk-scanFull"));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("impact-bulk-confirm"));
    await flush();

    expect(requests(fetchMock).map((r) => r.body)).toEqual([
      { projectConfigId: 11, full: true },
      { projectConfigId: 12, full: true },
    ]);
  });

  it("checks stale pins on every connection", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queued: true }));
    render(
      <ImpactBulkActions
        configs={configs}
        staleByConfig={new Map()}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-bulk-checkStale"));
    await flush();

    expect(requests(fetchMock).map((r) => r.url)).toEqual([
      "/api/code-repositories/3/stale-pins/check",
      "/api/code-repositories/4/stale-pins/check",
    ]);
  });

  it("offers removal only when stale pins exist, and removes them where they are", async () => {
    const { rerender } = render(
      <ImpactBulkActions
        configs={configs}
        staleByConfig={new Map()}
        onChanged={onChanged}
      />
    );
    expect(screen.queryByTestId("impact-bulk-removeStale")).toBeNull();

    fetchMock.mockResolvedValue(jsonResponse({ removed: 4 }));
    rerender(
      <ImpactBulkActions
        configs={configs}
        staleByConfig={new Map([[12, 4]])}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByTestId("impact-bulk-removeStale"));
    fireEvent.click(screen.getByTestId("impact-bulk-confirm"));
    await flush();

    expect(requests(fetchMock)).toEqual([
      {
        url: "/api/code-repositories/4/stale-pins/remove",
        body: { projectConfigId: 12 },
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith(
      'projects.settings.impact.stalePins.removed{"count":4}'
    );
  });

  it("names the repositories whose request failed", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ queued: true }))
      .mockResolvedValueOnce(jsonResponse({ error: "Forbidden" }, false));
    render(
      <ImpactBulkActions
        configs={configs}
        staleByConfig={new Map()}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-bulk-checkStale"));
    await flush();

    expect(toast.info).toHaveBeenCalledWith(
      'projects.settings.impact.bulk.queued{"count":1,"skipped":0}'
    );
    expect(toast.error).toHaveBeenCalledWith(
      'projects.settings.impact.bulk.failed{"names":"acme/api"}'
    );
  });
});
