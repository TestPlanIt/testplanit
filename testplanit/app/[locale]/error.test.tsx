import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ErrorPage from "./error";

const { mockReportPossibleSkew } = vi.hoisted(() => ({
  mockReportPossibleSkew: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("~/lib/deploymentSkew", () => ({
  reportPossibleSkew: mockReportPossibleSkew,
}));

describe("locale error page", () => {
  beforeEach(() => {
    mockReportPossibleSkew.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("re-fetches the failed segment when Try again is clicked", () => {
    const retry = vi.fn();
    render(<ErrorPage error={new Error("boom")} retry={retry} />);

    fireEvent.click(
      screen.getByRole("button", { name: "search.errors.tryAgain" })
    );

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows the error digest and reports the error for skew detection", () => {
    const error = Object.assign(new Error("boom"), { digest: "abc123" });
    render(<ErrorPage error={error} retry={vi.fn()} />);

    expect(screen.getByText("abc123")).toBeInTheDocument();
    expect(mockReportPossibleSkew).toHaveBeenCalledWith(error);
  });
});
