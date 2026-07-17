import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { ExtendedAuditLog } from "./columns";
import { AuditLogDetailModal } from "./AuditLogDetailModal";

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Mock next-auth/react. access=ADMIN so the admin-gated metadata section renders
// (the modal only surfaces metadata — IP / user agent — to ADMIN / PROJECTADMIN).
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: {
        access: "ADMIN",
        preferences: {
          timezone: "Etc/UTC",
          dateFormat: "MM-dd-yyyy",
        },
      },
    },
  }),
}));

// Mock DateFormatter to avoid date formatting complexity
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({ date }: { date: Date | string }) => (
    <span data-testid="date-formatter">{String(date)}</span>
  ),
}));

// The record-key config hook reads AppConfig via React Query (not part of the
// mocked useClientQueries below); stub it so the modal renders without the extra
// key field (feature-off: formatKey → null).
vi.mock("~/hooks/useRecordKeyConfig", () => ({
  useRecordKeyConfig: () => ({ formatKey: () => null }),
}));

// Mock the ZenStack hook the modal uses to fetch the full audit log by id.
// Tests mutate `mockHookReturn.value` before each render to control what the
// modal receives.
const mockHookReturn = vi.hoisted(() => ({
  value: { data: undefined, isLoading: false } as {
    data: ExtendedAuditLog | undefined;
    isLoading: boolean;
  },
}));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    auditLog: { useFindUnique: () => mockHookReturn.value },
  }),
}));

const baseLog: ExtendedAuditLog = {
  id: "log-001",
  action: "CREATE" as any,
  entityType: "TestCase",
  entityId: "abc-123",
  entityName: "My Test",
  userId: "user-001",
  userName: "Admin User",
  userEmail: "admin@test.com",
  timestamp: new Date("2024-01-15T10:00:00Z"),
  changes: null,
  metadata: null,
  projectId: null,
  project: null,
  operationId: null,
  sourceTable: null,
};

function setHookData(log: ExtendedAuditLog | undefined, isLoading = false) {
  mockHookReturn.value = { data: log, isLoading };
}

describe("AuditLogDetailModal", () => {
  beforeEach(() => {
    setHookData(undefined);
  });

  test("renders nothing when logId is null", () => {
    const { container } = render(
      <AuditLogDetailModal logId={null} open={true} onClose={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  test("renders loading state while the detail is being fetched", () => {
    setHookData(undefined, true);
    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  test("renders basic info for a log entry", () => {
    setHookData(baseLog);
    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );

    expect(screen.getByText("TestCase")).toBeInTheDocument();
    expect(screen.getByText("abc-123")).toBeInTheDocument();
    expect(screen.getByText("My Test")).toBeInTheDocument();
    expect(screen.getByText("Admin User")).toBeInTheDocument();
    expect(screen.getByText("admin@test.com")).toBeInTheDocument();
  });

  test("renders action badge with CREATE text", () => {
    setHookData(baseLog);
    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );
    expect(screen.getByText("CREATE")).toBeInTheDocument();
  });

  test("renders changes section with old and new values", () => {
    setHookData({
      ...baseLog,
      changes: {
        name: { old: "Old Name", new: "New Name" },
      } as any,
    });

    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );

    expect(screen.getByText("admin.auditLogs.changes")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText(/admin\.auditLogs\.oldValue/)).toBeInTheDocument();
    expect(screen.getByText(/admin\.auditLogs\.newValue/)).toBeInTheDocument();
    expect(screen.getByText("Old Name")).toBeInTheDocument();
    expect(screen.getByText("New Name")).toBeInTheDocument();
  });

  test("renders metadata section as JSON", () => {
    setHookData({
      ...baseLog,
      metadata: {
        ipAddress: "1.2.3.4",
        userAgent: "Mozilla/5.0",
      } as any,
    });

    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );

    expect(screen.getByText("admin.auditLogs.metadata")).toBeInTheDocument();
    expect(screen.getByText(/1\.2\.3\.4/)).toBeInTheDocument();
    expect(screen.getByText(/Mozilla\/5\.0/)).toBeInTheDocument();
  });

  test("hides changes section when changes is null", () => {
    setHookData({ ...baseLog, changes: null });

    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );

    expect(
      screen.queryByText("admin.auditLogs.changes")
    ).not.toBeInTheDocument();
  });

  test("hides changes section when changes is empty object", () => {
    setHookData({ ...baseLog, changes: {} as any });

    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );

    expect(
      screen.queryByText("admin.auditLogs.changes")
    ).not.toBeInTheDocument();
  });

  test("renders project name when project is present", () => {
    setHookData({
      ...baseLog,
      projectId: 1,
      project: { name: "My Project" },
    });

    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );

    expect(screen.getByText("My Project")).toBeInTheDocument();
  });

  test("calls onClose when dialog close is triggered", async () => {
    setHookData(baseLog);
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={onClose} />
    );

    const closeButton = screen.getByRole("button", { name: /close/i });
    await user.click(closeButton);

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  test("renders date formatter for the log timestamp", () => {
    setHookData(baseLog);
    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );
    expect(screen.getByTestId("date-formatter")).toBeInTheDocument();
  });

  test("renders a SCIM badge when metadata.source is scim", () => {
    setHookData({
      ...baseLog,
      metadata: { source: "scim", scimTokenId: "tok-1" } as any,
    });
    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );
    expect(
      screen.getByTestId("audit-log-source-scim-badge")
    ).toBeInTheDocument();
  });

  test("does not render a SCIM badge for non-scim sources", () => {
    setHookData({ ...baseLog, metadata: { source: "api" } as any });
    render(
      <AuditLogDetailModal logId="log-001" open={true} onClose={vi.fn()} />
    );
    expect(screen.queryByTestId("audit-log-source-scim-badge")).toBeNull();
  });
});
