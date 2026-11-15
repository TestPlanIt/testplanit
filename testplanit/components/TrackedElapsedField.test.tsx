import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "~/test/test-utils";
import {
  executionTimerKey,
  readExecutionTimer,
  resetExecutionTimersForTest,
  setExecutionTimer,
} from "~/hooks/useExecutionTimer";
import { TrackedElapsedField } from "./TrackedElapsedField";

const KEY = executionTimerKey(1, 2);
const formatSeconds = (seconds: number) => (seconds ? `${seconds}s` : "");
const input = () => screen.getByTestId("elapsed-input") as HTMLInputElement;

function renderField(onTextChange = vi.fn()) {
  render(
    <TrackedElapsedField
      timerKey={KEY}
      formatSeconds={formatSeconds}
      onTextChange={onTextChange}
    />
  );
  return onTextChange;
}

describe("TrackedElapsedField", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    resetExecutionTimersForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens with the time already tracked on the case", () => {
    setExecutionTimer(KEY, 40);
    renderField();
    expect(input().value).toBe("40s");
  });

  it("counts on screen without writing to the form", () => {
    const onTextChange = renderField();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(input().value).toBe("3s");
    expect(screen.getByTestId("time-tracker")).toHaveAttribute(
      "data-running",
      "true"
    );
    expect(onTextChange).not.toHaveBeenCalled();
  });

  it("stops the clock at a typed duration", () => {
    const onTextChange = renderField();
    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    fireEvent.change(input(), { target: { value: "5m 30s" } });
    expect(onTextChange).toHaveBeenLastCalledWith("5m 30s");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(readExecutionTimer(KEY)).toBe(330);
    expect(input().value).toBe("5m 30s");
    expect(screen.getByTestId("time-tracker")).toHaveAttribute(
      "data-running",
      "false"
    );

    fireEvent.blur(input());
    expect(input().value).toBe("330s");
    expect(onTextChange).toHaveBeenLastCalledWith("");
  });

  it("keeps text that is not a duration for the form to reject", () => {
    const onTextChange = renderField();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    fireEvent.change(input(), { target: { value: "soon" } });
    fireEvent.blur(input());

    expect(input().value).toBe("soon");
    expect(onTextChange).toHaveBeenLastCalledWith("soon");
    expect(readExecutionTimer(KEY)).toBe(4);
  });

  it("clears the time when the text is deleted", () => {
    renderField();
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    fireEvent.change(input(), { target: { value: "" } });
    expect(readExecutionTimer(KEY)).toBe(0);
  });

  it("resumes from the tracker's play button", () => {
    renderField();
    fireEvent.change(input(), { target: { value: "1m" } });
    fireEvent.click(screen.getByTestId("time-tracker-toggle"));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(readExecutionTimer(KEY)).toBe(62);
    expect(input().value).toBe("62s");
  });
});
