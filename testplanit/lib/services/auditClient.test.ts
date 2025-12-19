import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logDataExport } from "./auditClient";

describe("auditClient", () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("logDataExport", () => {
    it("should call fetch with correct URL and method", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await logDataExport({
        exportType: "CSV",
        entityType: "TestCase",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/audit/export",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
    });

    it("should send exportType and entityType in body", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await logDataExport({
        exportType: "PDF",
        entityType: "TestRun",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/audit/export",
        expect.objectContaining({
          body: expect.stringContaining('"exportType":"PDF"'),
        })
      );
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/audit/export",
        expect.objectContaining({
          body: expect.stringContaining('"entityType":"TestRun"'),
        })
      );
    });

    it("should send optional recordCount", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await logDataExport({
        exportType: "CSV",
        entityType: "TestCase",
        recordCount: 150,
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.recordCount).toBe(150);
    });

    it("should send optional filters", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const filters = { status: "passed", dateRange: "2024-01-01:2024-12-31" };
      await logDataExport({
        exportType: "CSV",
        entityType: "TestResult",
        filters,
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.filters).toEqual(filters);
    });

    it("should send optional projectId", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await logDataExport({
        exportType: "CSV",
        entityType: "TestCase",
        projectId: 42,
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body.projectId).toBe(42);
    });

    it("should send all parameters together", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      await logDataExport({
        exportType: "PDF",
        entityType: "Report",
        recordCount: 500,
        filters: { reportType: "summary" },
        projectId: 123,
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({
        exportType: "PDF",
        entityType: "Report",
        recordCount: 500,
        filters: { reportType: "summary" },
        projectId: 123,
      });
    });

    describe("error handling", () => {
      it("should not throw on fetch error", async () => {
        mockFetch.mockRejectedValueOnce(new Error("Network error"));
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        // Should not throw
        await expect(
          logDataExport({
            exportType: "CSV",
            entityType: "TestCase",
          })
        ).resolves.toBeUndefined();

        consoleSpy.mockRestore();
      });

      it("should log warning on fetch error", async () => {
        const error = new Error("Network error");
        mockFetch.mockRejectedValueOnce(error);
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        await logDataExport({
          exportType: "CSV",
          entityType: "TestCase",
        });

        expect(consoleSpy).toHaveBeenCalledWith(
          "[AuditClient] Error logging export:",
          error
        );

        consoleSpy.mockRestore();
      });

      it("should not throw on non-OK response", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: "Internal Server Error",
        });
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        await expect(
          logDataExport({
            exportType: "CSV",
            entityType: "TestCase",
          })
        ).resolves.toBeUndefined();

        consoleSpy.mockRestore();
      });

      it("should log warning on non-OK response", async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          statusText: "Forbidden",
        });
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        await logDataExport({
          exportType: "CSV",
          entityType: "TestCase",
        });

        expect(consoleSpy).toHaveBeenCalledWith(
          "[AuditClient] Failed to log export:",
          "Forbidden"
        );

        consoleSpy.mockRestore();
      });

      it("should not log warning on successful response", async () => {
        mockFetch.mockResolvedValueOnce({ ok: true });
        const consoleSpy = vi
          .spyOn(console, "warn")
          .mockImplementation(() => {});

        await logDataExport({
          exportType: "CSV",
          entityType: "TestCase",
        });

        expect(consoleSpy).not.toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });

    describe("return value", () => {
      it("should return void on success", async () => {
        mockFetch.mockResolvedValueOnce({ ok: true });

        const result = await logDataExport({
          exportType: "CSV",
          entityType: "TestCase",
        });

        expect(result).toBeUndefined();
      });

      it("should return void on error", async () => {
        mockFetch.mockRejectedValueOnce(new Error("Error"));
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await logDataExport({
          exportType: "CSV",
          entityType: "TestCase",
        });

        expect(result).toBeUndefined();
      });
    });
  });
});
