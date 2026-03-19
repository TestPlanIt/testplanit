import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stable mock refs via vi.hoisted()
const { mockMutateAsync } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", name: "Test User", email: "test@example.com" } },
    status: "authenticated",
  }),
}));

// Mock ~/lib/hooks useCreateShareLink
vi.mock("~/lib/hooks", () => ({
  useCreateShareLink: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

// Mock server actions
vi.mock("@/actions/share-links", () => ({
  auditShareLinkCreation: vi.fn().mockResolvedValue(undefined),
  prepareShareLinkData: vi.fn().mockResolvedValue({ shareKey: "test-key", passwordHash: null }),
}));

// Mock @prisma/client ShareLinkMode enum
vi.mock("@prisma/client", () => ({
  ShareLinkMode: {
    AUTHENTICATED: "AUTHENTICATED",
    PASSWORD_PROTECTED: "PASSWORD_PROTECTED",
    PUBLIC: "PUBLIC",
  },
}));

// Mock ShareLinkCreated and ShareLinkList
vi.mock("@/components/share/ShareLinkCreated", () => ({
  ShareLinkCreated: ({ onClose, onCreateAnother }: any) => (
    <div data-testid="share-link-created">
      <button onClick={onClose}>close created</button>
      <button onClick={onCreateAnother}>create another</button>
    </div>
  ),
}));

vi.mock("@/components/share/ShareLinkList", () => ({
  ShareLinkList: () => <div data-testid="share-link-list" />,
}));

// Mock date-fns format
vi.mock("date-fns", () => ({
  format: (_date: any, formatStr: string) => `formatted-${formatStr}`,
}));

// Mock ~/utils cn
vi.mock("~/utils", () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(" "),
}));

import { ShareDialog } from "../reports/ShareDialog";

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: 1,
  reportConfig: { reportType: "repository-stats" },
  reportTitle: "My Report",
};

describe("ShareDialog", () => {
  it("renders dialog when open is true", () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByText("dialogTitle")).toBeInTheDocument();
  });

  it("does not render dialog content when open is false", () => {
    render(<ShareDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("dialogTitle")).not.toBeInTheDocument();
  });

  it("shows create tab and list tab", () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByTestId("share-tab-create")).toBeInTheDocument();
    expect(screen.getByTestId("share-tab-list")).toBeInTheDocument();
  });

  it("shows mode selection radio options", () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByTestId("share-mode-authenticated")).toBeInTheDocument();
    expect(screen.getByTestId("share-mode-password")).toBeInTheDocument();
    expect(screen.getByTestId("share-mode-public")).toBeInTheDocument();
  });

  it("does not show password fields by default (AUTHENTICATED mode)", () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.queryByTestId("share-password-input")).not.toBeInTheDocument();
  });

  it("shows password fields when PASSWORD_PROTECTED mode is selected", () => {
    render(<ShareDialog {...defaultProps} />);
    const passwordRadio = screen.getByTestId("share-mode-password");
    fireEvent.click(passwordRadio);
    expect(screen.getByTestId("share-password-input")).toBeInTheDocument();
    expect(screen.getByTestId("share-confirm-password-input")).toBeInTheDocument();
  });

  it("shows title and description inputs", () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByTestId("share-title-input")).toBeInTheDocument();
    expect(screen.getByTestId("share-description-input")).toBeInTheDocument();
  });

  it("renders create share link button", () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByTestId("share-create-button")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) when cancel button clicked", () => {
    const onOpenChange = vi.fn();
    render(<ShareDialog {...defaultProps} onOpenChange={onOpenChange} />);
    const cancelButton = screen.getByText("cancel");
    fireEvent.click(cancelButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders notify on view checkbox", () => {
    render(<ShareDialog {...defaultProps} />);
    expect(screen.getByTestId("share-notify-checkbox")).toBeInTheDocument();
  });

  it("renders list tab trigger with correct test id", () => {
    render(<ShareDialog {...defaultProps} />);
    const listTab = screen.getByTestId("share-tab-list");
    expect(listTab).toBeInTheDocument();
    // Tab content (ShareLinkList) is present in DOM as hidden TabsContent
    // Radix Tabs renders all content, hiding inactive panels with CSS
    // Verify the list tab trigger exists and is accessible
    expect(listTab).toHaveAttribute("data-testid", "share-tab-list");
  });

  it("shows ShareLinkCreated when share is created successfully", async () => {
    mockMutateAsync.mockResolvedValueOnce({
      id: 1,
      shareKey: "abc123",
      entityType: "REPORT",
      mode: "AUTHENTICATED",
      title: "My Report",
      projectId: 1,
      expiresAt: null,
      notifyOnView: false,
      passwordHash: null,
    });

    render(<ShareDialog {...defaultProps} />);
    const createButton = screen.getByTestId("share-create-button");
    fireEvent.click(createButton);

    // Wait for async state update
    await screen.findByTestId("share-link-created");
  });
});
