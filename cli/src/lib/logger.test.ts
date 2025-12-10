import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock chalk and ora before importing logger
vi.mock("chalk", () => ({
  default: {
    blue: vi.fn((s: string) => `[blue]${s}[/blue]`),
    green: vi.fn((s: string) => `[green]${s}[/green]`),
    yellow: vi.fn((s: string) => `[yellow]${s}[/yellow]`),
    red: vi.fn((s: string) => `[red]${s}[/red]`),
    gray: vi.fn((s: string) => `[gray]${s}[/gray]`),
    cyan: {
      underline: vi.fn((s: string) => `[cyan-underline]${s}[/cyan-underline]`),
    },
    bold: vi.fn((s: string) => `[bold]${s}[/bold]`),
    dim: vi.fn((s: string) => `[dim]${s}[/dim]`),
  },
}));

vi.mock("ora", () => {
  const mockSpinner = {
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    text: "",
  };
  return {
    default: vi.fn(() => mockSpinner),
  };
});

import {
  info,
  success,
  warn,
  error,
  debug,
  startSpinner,
  updateSpinner,
  succeedSpinner,
  failSpinner,
  stopSpinner,
  formatUrl,
  formatNumber,
  formatToken,
} from "./logger.js";
import ora from "ora";

describe("Logger Module", () => {
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.DEBUG;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.env = { ...originalEnv };
    // Clean up any active spinner
    stopSpinner();
  });

  describe("info", () => {
    it("logs info message with blue icon", () => {
      info("Test info message");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[blue]ℹ[/blue]",
        "Test info message"
      );
    });
  });

  describe("success", () => {
    it("logs success message with green icon", () => {
      success("Test success message");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[green]✔[/green]",
        "Test success message"
      );
    });
  });

  describe("warn", () => {
    it("logs warning message with yellow icon", () => {
      warn("Test warning message");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[yellow]⚠[/yellow]",
        "Test warning message"
      );
    });
  });

  describe("error", () => {
    it("logs error message with red icon to stderr", () => {
      error("Test error message");

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[red]✖[/red]",
        "Test error message"
      );
    });
  });

  describe("debug", () => {
    it("does not log when DEBUG env var is not set", () => {
      debug("Test debug message");

      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("logs debug message when DEBUG env var is set", () => {
      process.env.DEBUG = "true";

      debug("Test debug message");

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "[gray]⊡[/gray]",
        "[gray]Test debug message[/gray]"
      );
    });

    it("logs debug message when DEBUG env var is any truthy value", () => {
      process.env.DEBUG = "1";

      debug("Another debug message");

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe("Spinner functions", () => {
    describe("startSpinner", () => {
      it("creates and starts a new spinner", () => {
        const spinner = startSpinner("Loading...");

        expect(ora).toHaveBeenCalledWith("Loading...");
        expect(spinner.start).toHaveBeenCalled();
      });

      it("stops existing spinner before starting new one", () => {
        const firstSpinner = startSpinner("First");
        const secondSpinner = startSpinner("Second");

        expect(firstSpinner.stop).toHaveBeenCalled();
      });
    });

    describe("updateSpinner", () => {
      it("updates current spinner text", () => {
        const spinner = startSpinner("Initial");

        updateSpinner("Updated text");

        expect(spinner.text).toBe("Updated text");
      });

      it("does nothing when no spinner is active", () => {
        // Ensure no spinner is active
        stopSpinner();

        // Should not throw
        updateSpinner("Some text");
      });
    });

    describe("succeedSpinner", () => {
      it("marks spinner as successful with message", () => {
        const spinner = startSpinner("Working...");

        succeedSpinner("Done!");

        expect(spinner.succeed).toHaveBeenCalledWith("Done!");
      });

      it("marks spinner as successful without message", () => {
        const spinner = startSpinner("Working...");

        succeedSpinner();

        expect(spinner.succeed).toHaveBeenCalledWith(undefined);
      });

      it("does nothing when no spinner is active", () => {
        stopSpinner();

        // Should not throw
        succeedSpinner("Message");
      });
    });

    describe("failSpinner", () => {
      it("marks spinner as failed with message", () => {
        const spinner = startSpinner("Working...");

        failSpinner("Failed!");

        expect(spinner.fail).toHaveBeenCalledWith("Failed!");
      });

      it("marks spinner as failed without message", () => {
        const spinner = startSpinner("Working...");

        failSpinner();

        expect(spinner.fail).toHaveBeenCalledWith(undefined);
      });

      it("does nothing when no spinner is active", () => {
        stopSpinner();

        // Should not throw
        failSpinner("Message");
      });
    });

    describe("stopSpinner", () => {
      it("stops current spinner", () => {
        const spinner = startSpinner("Working...");

        stopSpinner();

        expect(spinner.stop).toHaveBeenCalled();
      });

      it("does nothing when no spinner is active", () => {
        stopSpinner();

        // Should not throw
        stopSpinner();
      });
    });
  });

  describe("Formatting functions", () => {
    describe("formatUrl", () => {
      it("formats URL with cyan underline", () => {
        const result = formatUrl("https://example.com");

        expect(result).toBe("[cyan-underline]https://example.com[/cyan-underline]");
      });
    });

    describe("formatNumber", () => {
      it("formats number in bold", () => {
        const result = formatNumber(42);

        expect(result).toBe("[bold]42[/bold]");
      });

      it("formats zero", () => {
        const result = formatNumber(0);

        expect(result).toBe("[bold]0[/bold]");
      });

      it("formats large numbers", () => {
        const result = formatNumber(1234567);

        expect(result).toBe("[bold]1234567[/bold]");
      });
    });

    describe("formatToken", () => {
      it("masks short tokens completely", () => {
        const result = formatToken("short");

        expect(result).toBe("[dim]****[/dim]");
      });

      it("masks tokens of exactly 8 characters", () => {
        const result = formatToken("12345678");

        expect(result).toBe("[dim]****[/dim]");
      });

      it("shows first 8 and last 4 characters for longer tokens", () => {
        const result = formatToken("tpi_abcdef123456789xyz");
        // Token: tpi_abcdef123456789xyz (22 chars)
        // First 8: tpi_abcd
        // Last 4: 9xyz
        expect(result).toBe("[dim]tpi_abcd...9xyz[/dim]");
      });

      it("handles typical API token format", () => {
        const result = formatToken("tpi_a1b2c3d4e5f6g7h8i9j0");

        // First 8: tpi_a1b2
        // Last 4: 9j0
        expect(result).toContain("tpi_a1b2");
        expect(result).toContain("...");
      });
    });
  });
});
