import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { QueueManagement } from "./QueueManagement";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

// Mock QueueJobsView to avoid nested fetch complexity
vi.mock("./QueueJobsView", () => ({
  QueueJobsView: ({ queueName }: { queueName: string }) => (
    <div data-testid="queue-jobs-view">{queueName}</div>
  ),
}));

const mockQueues = [
  {
    name: "emails",
    counts: { waiting: 5, active: 1, completed: 100, failed: 2, delayed: 0, paused: 0 },
    isPaused: false,
    error: null,
    concurrency: 3,
  },
];

const mockPausedQueue = [
  {
    name: "emails",
    counts: { waiting: 0, active: 0, completed: 50, failed: 0, delayed: 0, paused: 10 },
    isPaused: true,
    error: null,
    concurrency: 2,
  },
];

const mockErrorQueue = [
  {
    name: "emails",
    counts: null,
    isPaused: false,
    error: "Connection failed",
    concurrency: 1,
  },
];

function makeSuccessFetch(queues: any[]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ queues }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("QueueManagement", () => {
  test("shows refresh button disabled while loading", () => {
    // Make fetch pend forever so loading remains true
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<QueueManagement />);

    const refreshButton = screen.getByRole("button", {
      name: /common\.actions\.refresh/i,
    });
    expect(refreshButton).toBeDisabled();
  });

  test("renders populated queue table with queue name and counts", async () => {
    global.fetch = makeSuccessFetch(mockQueues);
    render(<QueueManagement />);

    // The queue name "emails" maps to translation key admin.queues.queueNames.emails
    await waitFor(() => {
      expect(screen.getByText("admin.queues.queueNames.emails")).toBeInTheDocument();
    });

    // Count cells
    expect(screen.getByText("5")).toBeInTheDocument(); // waiting
    expect(screen.getByText("1")).toBeInTheDocument(); // active
    expect(screen.getByText("100")).toBeInTheDocument(); // completed
    expect(screen.getByText("2")).toBeInTheDocument(); // failed
  });

  test("renders active badge for queue with active jobs", async () => {
    global.fetch = makeSuccessFetch(mockQueues);
    render(<QueueManagement />);

    await waitFor(() => {
      // Active badge shows "common.fields.isActive"
      expect(screen.getByText("common.fields.isActive")).toBeInTheDocument();
    });
  });

  test("renders destructive error badge for queue with error", async () => {
    global.fetch = makeSuccessFetch(mockErrorQueue);
    render(<QueueManagement />);

    await waitFor(() => {
      // Error badge shows "common.errors.error"
      expect(screen.getByText("common.errors.error")).toBeInTheDocument();
    });
  });

  test("renders paused badge for paused queue", async () => {
    global.fetch = makeSuccessFetch(mockPausedQueue);
    render(<QueueManagement />);

    await waitFor(() => {
      expect(screen.getByText("admin.queues.status.paused")).toBeInTheDocument();
    });
  });

  test("clicking Pause button calls fetch POST with pause action", async () => {
    global.fetch = makeSuccessFetch(mockQueues);
    render(<QueueManagement />);

    await waitFor(() => {
      expect(screen.getByText("admin.queues.queueNames.emails")).toBeInTheDocument();
    });

    // Reassign fetch to capture the action POST + reload
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: "Queue paused" }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ queues: mockQueues }),
      });

    // The Pause button is the small action button without bg-destructive
    const actionButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.classList.contains("px-2") &&
          !b.getAttribute("class")?.includes("bg-destructive")
      );
    expect(actionButtons.length).toBeGreaterThan(0);
    fireEvent.click(actionButtons[0]);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCall = calls.find(
        (c) => c[1]?.method === "POST" && String(c[0]).includes("/api/admin/queues/emails")
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.action).toBe("pause");
    });
  });

  test("paused queue shows resume (Play) button that calls fetch with resume action", async () => {
    global.fetch = makeSuccessFetch(mockPausedQueue);
    render(<QueueManagement />);

    await waitFor(() => {
      expect(screen.getByText("admin.queues.status.paused")).toBeInTheDocument();
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: "Queue resumed" }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ queues: mockPausedQueue }),
      });

    // Paused queue renders a Play (resume) button — small action button without bg-destructive
    const actionButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.classList.contains("px-2") &&
          !b.getAttribute("class")?.includes("bg-destructive")
      );
    expect(actionButtons.length).toBeGreaterThan(0);
    fireEvent.click(actionButtons[0]);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCall = calls.find(
        (c) => c[1]?.method === "POST" && String(c[0]).includes("/api/admin/queues/emails")
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.action).toBe("resume");
    });
  });

  test("clicking clean (Trash2) button shows confirmation dialog", async () => {
    global.fetch = makeSuccessFetch(mockQueues);
    render(<QueueManagement />);

    await waitFor(() => {
      expect(screen.getByText("admin.queues.queueNames.emails")).toBeInTheDocument();
    });

    // Find the small destructive Trash2 button in actions column
    const destructiveSmallButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.getAttribute("class")?.includes("destructive") &&
          b.classList.contains("px-2")
      );
    expect(destructiveSmallButtons.length).toBeGreaterThan(0);
    fireEvent.click(destructiveSmallButtons[0]);

    // Confirmation dialog should appear
    expect(screen.getByText("admin.queues.actions.clean.confirmTitle")).toBeInTheDocument();
  });

  test("confirming clean dialog calls fetch with clean action", async () => {
    global.fetch = makeSuccessFetch(mockQueues);
    render(<QueueManagement />);

    await waitFor(() => {
      expect(screen.getByText("admin.queues.queueNames.emails")).toBeInTheDocument();
    });

    // Open confirmation dialog
    const destructiveSmallButtons = screen
      .getAllByRole("button")
      .filter(
        (b) =>
          b.getAttribute("class")?.includes("destructive") &&
          b.classList.contains("px-2")
      );
    fireEvent.click(destructiveSmallButtons[0]);

    expect(screen.getByText("admin.queues.actions.clean.confirmTitle")).toBeInTheDocument();

    // Reassign fetch to capture clean call
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: "Queue cleaned" }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ queues: mockQueues }),
      });

    const confirmButton = screen.getByRole("button", {
      name: "common.actions.confirm",
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
      const postCall = calls.find(
        (c) => c[1]?.method === "POST" && String(c[0]).includes("/api/admin/queues/emails")
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1].body);
      expect(body.action).toBe("clean");
    });
  });

  test("auto-refresh calls fetch again after 10-second interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = makeSuccessFetch(mockQueues);
    global.fetch = fetchMock;

    render(<QueueManagement />);

    // Wait for initial load using a micro-task flush
    await vi.advanceTimersByTimeAsync(100);

    const callCountAfterMount = fetchMock.mock.calls.length;
    expect(callCountAfterMount).toBeGreaterThanOrEqual(1);

    // Advance timer by 10 seconds to trigger interval refresh
    await vi.advanceTimersByTimeAsync(10000);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callCountAfterMount);
  });
});
