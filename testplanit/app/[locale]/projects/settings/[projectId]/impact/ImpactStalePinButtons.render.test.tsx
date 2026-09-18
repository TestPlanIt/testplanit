import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
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
  toast: { info: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({ toast }));

import { ImpactStalePinButtons } from "./ImpactStalePinButtons";

const config = {
  id: 11,
  repositoryId: 3,
  stalePinReport: null as unknown,
  repository: { name: "acme/app" },
};

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as unknown as Response;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("ImpactStalePinButtons", () => {
  const fetchMock = vi.fn();
  const onChanged = vi.fn(async (): Promise<unknown> => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queues a check for its own connection and reloads", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ queued: true, jobId: "j1" }));
    render(
      <ImpactStalePinButtons
        config={config}
        staleCount={0}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-repo-stale-check-11"));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/code-repositories/3/stale-pins/check",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectConfigId: 11 }),
      })
    );
    expect(toast.info).toHaveBeenCalledWith(
      "projects.settings.impact.stalePins.checkStarted"
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("impact-repo-stale-remove-11")).toBeNull();
  });

  it("disables the check while one is running for the connection", () => {
    render(
      <ImpactStalePinButtons
        config={{
          ...config,
          stalePinReport: {
            running: true,
            startedAt: new Date().toISOString(),
          },
        }}
        staleCount={4}
        onChanged={onChanged}
      />
    );

    expect(screen.getByTestId("impact-repo-stale-check-11")).toBeDisabled();
    // Nothing can be removed until the running check has its say.
    expect(screen.queryByTestId("impact-repo-stale-remove-11")).toBeNull();
  });

  it("lets an abandoned check be queued again", () => {
    render(
      <ImpactStalePinButtons
        config={{
          ...config,
          stalePinReport: {
            running: true,
            startedAt: "2026-01-01T00:00:00Z",
            progressAt: "2026-01-01T00:00:00Z",
          },
        }}
        staleCount={0}
        onChanged={onChanged}
      />
    );

    expect(screen.getByTestId("impact-repo-stale-check-11")).toBeEnabled();
  });

  it("removes the flagged pins after confirmation and reports the count", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ removed: 4 }));
    render(
      <ImpactStalePinButtons
        config={config}
        staleCount={4}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-repo-stale-remove-11"));
    fireEvent.click(screen.getByTestId("impact-repo-stale-remove-confirm-11"));
    await flush();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/code-repositories/3/stale-pins/remove",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ projectConfigId: 11 }),
      })
    );
    expect(toast.success).toHaveBeenCalledWith(
      "projects.settings.impact.stalePins.removed"
    );
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("shows the server's error under the buttons", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Background job queue is not available." }, false)
    );
    render(
      <ImpactStalePinButtons
        config={config}
        staleCount={0}
        onChanged={onChanged}
      />
    );

    fireEvent.click(screen.getByTestId("impact-repo-stale-check-11"));
    await flush();

    expect(screen.getByTestId("impact-repo-stale-error-11")).toHaveTextContent(
      "Background job queue is not available."
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
