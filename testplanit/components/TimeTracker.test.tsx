import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "~/test/test-utils";
import { TimeTracker } from "./TimeTracker";

const minutes = () =>
  screen.getByTestId("time-tracker-minutes") as HTMLInputElement;
const seconds = () =>
  screen.getByTestId("time-tracker-seconds") as HTMLInputElement;

describe("TimeTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("keeping its own time", () => {
    it("starts stopped at zero and counts once started", () => {
      const onTimeUpdate = vi.fn();
      render(<TimeTracker onTimeUpdate={onTimeUpdate} />);
      expect(minutes().value).toBe("00");
      expect(seconds().value).toBe("00");

      fireEvent.click(screen.getByTestId("time-tracker-toggle"));
      act(() => {
        vi.advanceTimersByTime(3_100);
      });

      expect(seconds().value).toBe("03");
      expect(onTimeUpdate).toHaveBeenLastCalledWith(3);
    });

    it("holds its time while paused and takes a typed one", () => {
      const onTimeUpdate = vi.fn();
      render(<TimeTracker onTimeUpdate={onTimeUpdate} />);
      fireEvent.click(screen.getByTestId("time-tracker-toggle"));
      act(() => {
        vi.advanceTimersByTime(2_100);
      });
      fireEvent.click(screen.getByTestId("time-tracker-toggle"));
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(seconds().value).toBe("02");

      fireEvent.change(minutes(), { target: { value: "4" } });
      fireEvent.blur(minutes());
      expect(minutes().value).toBe("04");
      expect(onTimeUpdate).toHaveBeenLastCalledWith(242);
    });
  });

  describe("drawing a time kept elsewhere", () => {
    it("shows the given time and running state", () => {
      const { rerender } = render(<TimeTracker value={125} running />);
      expect(minutes().value).toBe("02");
      expect(seconds().value).toBe("05");
      expect(screen.getByTestId("time-tracker")).toHaveAttribute(
        "data-running",
        "true"
      );
      expect(minutes()).toBeDisabled();

      rerender(<TimeTracker value={126} running />);
      expect(seconds().value).toBe("06");
    });

    it("does not count by itself", () => {
      render(<TimeTracker value={10} running />);
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(seconds().value).toBe("10");
    });

    it("asks to pause and to start instead of doing it", () => {
      const onRunningChange = vi.fn();
      const { rerender } = render(
        <TimeTracker value={10} running onRunningChange={onRunningChange} />
      );
      fireEvent.click(screen.getByTestId("time-tracker-toggle"));
      expect(onRunningChange).toHaveBeenLastCalledWith(false);
      expect(screen.getByTestId("time-tracker")).toHaveAttribute(
        "data-running",
        "true"
      );

      rerender(
        <TimeTracker
          value={10}
          running={false}
          onRunningChange={onRunningChange}
        />
      );
      fireEvent.click(screen.getByTestId("time-tracker-toggle"));
      expect(onRunningChange).toHaveBeenLastCalledWith(true);
    });

    it("reports a typed time while paused", () => {
      const onValueChange = vi.fn();
      render(
        <TimeTracker value={10} running={false} onValueChange={onValueChange} />
      );
      fireEvent.change(seconds(), { target: { value: "45" } });
      fireEvent.blur(seconds());
      expect(onValueChange).toHaveBeenLastCalledWith(45);
    });

    it("shows more than 99 minutes", () => {
      render(<TimeTracker value={125 * 60 + 7} running />);
      expect(minutes().value).toBe("125");
      expect(seconds().value).toBe("07");
    });
  });
});
