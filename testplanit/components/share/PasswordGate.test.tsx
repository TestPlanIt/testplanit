import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock PasswordDialog child component
vi.mock("./PasswordDialog", () => ({
  PasswordDialog: ({ onSuccess }: { shareKey: string; projectName: string; onSuccess: (token: string, expiresIn: number) => void }) => (
    <div data-testid="password-dialog">
      <button
        data-testid="simulate-password-success"
        onClick={() => onSuccess("test-token", 3600)}
      >
        Enter Password
      </button>
    </div>
  ),
}));

import { PasswordGate } from "./PasswordGate";

const defaultProps = {
  shareKey: "test-share-key",
  onVerified: vi.fn(),
  projectName: "Test Project",
};

describe("PasswordGate", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("renders PasswordDialog when no valid token in sessionStorage", () => {
    render(<PasswordGate {...defaultProps} />);
    expect(screen.getByTestId("password-dialog")).toBeInTheDocument();
  });

  it("calls onVerified immediately if valid token exists in sessionStorage", async () => {
    const onVerified = vi.fn();
    const tokenKey = `share_token_${defaultProps.shareKey}`;
    const validExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
    sessionStorage.setItem(tokenKey, JSON.stringify({ token: "valid-token", expiresAt: validExpiry }));

    render(<PasswordGate {...defaultProps} onVerified={onVerified} />);

    await waitFor(() => {
      expect(onVerified).toHaveBeenCalledTimes(1);
    });
  });

  it("does not render PasswordDialog when valid token found (returns null)", async () => {
    const tokenKey = `share_token_${defaultProps.shareKey}`;
    const validExpiry = new Date(Date.now() + 3600 * 1000).toISOString();
    sessionStorage.setItem(tokenKey, JSON.stringify({ token: "valid-token", expiresAt: validExpiry }));

    render(<PasswordGate {...defaultProps} />);

    await waitFor(() => {
      expect(screen.queryByTestId("password-dialog")).not.toBeInTheDocument();
    });
  });

  it("stores token in sessionStorage and calls onVerified after password success", async () => {
    const onVerified = vi.fn();
    render(<PasswordGate {...defaultProps} onVerified={onVerified} />);

    expect(screen.getByTestId("password-dialog")).toBeInTheDocument();

    const successButton = screen.getByTestId("simulate-password-success");
    successButton.click();

    await waitFor(() => {
      expect(onVerified).toHaveBeenCalledTimes(1);
    });

    const tokenKey = `share_token_${defaultProps.shareKey}`;
    const stored = sessionStorage.getItem(tokenKey);
    expect(stored).toBeTruthy();
    const parsed = JSON.parse(stored!);
    expect(parsed.token).toBe("test-token");
    expect(new Date(parsed.expiresAt) > new Date()).toBe(true);
  });

  it("removes expired token from sessionStorage and shows dialog", () => {
    const tokenKey = `share_token_${defaultProps.shareKey}`;
    const expiredExpiry = new Date(Date.now() - 1000).toISOString();
    sessionStorage.setItem(tokenKey, JSON.stringify({ token: "expired-token", expiresAt: expiredExpiry }));

    render(<PasswordGate {...defaultProps} />);

    // Expired token removed, dialog shown
    expect(screen.getByTestId("password-dialog")).toBeInTheDocument();
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
  });

  it("handles malformed token JSON in sessionStorage gracefully", () => {
    const tokenKey = `share_token_${defaultProps.shareKey}`;
    sessionStorage.setItem(tokenKey, "not-valid-json{{{");

    // Should not throw; dialog is rendered
    render(<PasswordGate {...defaultProps} />);
    expect(screen.getByTestId("password-dialog")).toBeInTheDocument();
    expect(sessionStorage.getItem(tokenKey)).toBeNull();
  });
});
