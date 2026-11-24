import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { releaseDownloadUrl } from "./releaseDownloadUrl";

describe("releaseDownloadUrl", () => {
  const original = URL.revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    URL.revokeObjectURL = original;
  });

  it("keeps the address until the download has had time to start", () => {
    releaseDownloadUrl("blob:one");

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:one");
  });
});
