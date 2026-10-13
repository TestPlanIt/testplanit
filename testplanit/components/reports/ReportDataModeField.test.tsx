import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) => {
    const last = key.split(".").pop() ?? key;
    return params
      ? `${last} ${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`
      : last;
  },
}));

import {
  FrozenTruncationWarning,
  ReportDataModeField,
} from "./ReportDataModeField";

describe("ReportDataModeField", () => {
  it("renders the Live and Frozen options", () => {
    render(<ReportDataModeField value="live" onChange={vi.fn()} />);

    expect(screen.getByTestId("report-data-mode-live")).toBeInTheDocument();
    expect(screen.getByTestId("report-data-mode-frozen")).toBeInTheDocument();
    expect(screen.getAllByText("title")).toHaveLength(2);
    expect(screen.getAllByText("description")).toHaveLength(2);
  });

  it("reflects the live value", () => {
    render(<ReportDataModeField value="live" onChange={vi.fn()} />);

    expect(screen.getByTestId("report-data-mode-live")).toHaveAttribute(
      "data-state",
      "checked"
    );
    expect(screen.getByTestId("report-data-mode-frozen")).toHaveAttribute(
      "data-state",
      "unchecked"
    );
  });

  it("reflects the frozen value", () => {
    render(<ReportDataModeField value="frozen" onChange={vi.fn()} />);

    expect(screen.getByTestId("report-data-mode-frozen")).toHaveAttribute(
      "data-state",
      "checked"
    );
    expect(screen.getByTestId("report-data-mode-live")).toHaveAttribute(
      "data-state",
      "unchecked"
    );
  });

  it("calls onChange with 'frozen' when Frozen is picked", () => {
    const onChange = vi.fn();
    render(<ReportDataModeField value="live" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("report-data-mode-frozen"));

    expect(onChange).toHaveBeenCalledWith("frozen");
  });

  it("calls onChange with 'live' when Live is picked", () => {
    const onChange = vi.fn();
    render(<ReportDataModeField value="frozen" onChange={onChange} />);

    fireEvent.click(screen.getByTestId("report-data-mode-live"));

    expect(onChange).toHaveBeenCalledWith("live");
  });
});

describe("FrozenTruncationWarning", () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    onCancel.mockClear();
    onConfirm.mockClear();
  });

  it("stays closed when truncation is null", () => {
    render(
      <FrozenTruncationWarning
        truncation={null}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(
      screen.queryByTestId("frozen-truncation-warning")
    ).not.toBeInTheDocument();
  });

  it("opens with the title and a description naming the total and max", () => {
    render(
      <FrozenTruncationWarning
        truncation={{ totalRowCount: 12345, maxRows: 5000 }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    const dialog = screen.getByTestId("frozen-truncation-warning");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(
      screen.getByText("description total=12345 max=5000")
    ).toBeInTheDocument();
  });

  it("calls onCancel from Cancel", () => {
    render(
      <FrozenTruncationWarning
        truncation={{ totalRowCount: 10, maxRows: 5 }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByTestId("frozen-truncation-cancel"));

    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onConfirm from Save without cancelling", () => {
    render(
      <FrozenTruncationWarning
        truncation={{ totalRowCount: 10, maxRows: 5 }}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    fireEvent.click(screen.getByTestId("frozen-truncation-confirm"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("frozen-truncation-warning")).toBeInTheDocument();
  });

  it("disables both buttons when disabled", () => {
    render(
      <FrozenTruncationWarning
        truncation={{ totalRowCount: 10, maxRows: 5 }}
        disabled
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByTestId("frozen-truncation-cancel")).toBeDisabled();
    expect(screen.getByTestId("frozen-truncation-confirm")).toBeDisabled();
  });
});
