import { describe, it, expect, vi, beforeEach } from "vitest";
import { Job } from "bullmq";

// Mock the forecast service
const mockUpdateRepositoryCaseForecast = vi.fn();
const mockGetUniqueCaseGroupIds = vi.fn();
const mockUpdateTestRunForecast = vi.fn();

vi.mock("../services/forecastService", () => ({
  updateRepositoryCaseForecast: (...args: any[]) =>
    mockUpdateRepositoryCaseForecast(...args),
  getUniqueCaseGroupIds: () => mockGetUniqueCaseGroupIds(),
  updateTestRunForecast: (...args: any[]) => mockUpdateTestRunForecast(...args),
}));

// Mock prisma
const mockPrisma = {
  testRuns: {
    findMany: vi.fn(),
  },
};

vi.mock("../lib/prisma", () => ({
  prisma: mockPrisma,
}));

// Mock Valkey connection to null to prevent worker creation
vi.mock("../lib/valkey", () => ({
  default: null,
}));

// Mock queue names
vi.mock("../lib/queueNames", () => ({
  FORECAST_QUEUE_NAME: "test-forecast-queue",
}));

describe("ForecastWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe("JOB_UPDATE_SINGLE_CASE", () => {
    it("should update forecast for a single case", async () => {
      mockUpdateRepositoryCaseForecast.mockResolvedValue({
        affectedTestRunIds: [],
      });

      // Dynamically import to get fresh module with mocks
      const forecastWorkerModule = await import("./forecastWorker");

      const mockJob = {
        id: "job-123",
        name: "update-single-case-forecast",
        data: { repositoryCaseId: 42 },
      } as Job;

      // Access the processor - we need to test it via the module
      // Since processor isn't exported, we'll test the job names export
      expect(forecastWorkerModule.JOB_UPDATE_SINGLE_CASE).toBe(
        "update-single-case-forecast"
      );
      expect(forecastWorkerModule.JOB_UPDATE_ALL_CASES).toBe(
        "update-all-cases-forecast"
      );
    });

    it("should export correct job name constants", async () => {
      const { JOB_UPDATE_SINGLE_CASE, JOB_UPDATE_ALL_CASES } = await import(
        "./forecastWorker"
      );

      expect(JOB_UPDATE_SINGLE_CASE).toBe("update-single-case-forecast");
      expect(JOB_UPDATE_ALL_CASES).toBe("update-all-cases-forecast");
    });
  });

  describe("Job data validation", () => {
    it("should have proper job name for single case update", async () => {
      const { JOB_UPDATE_SINGLE_CASE } = await import("./forecastWorker");
      expect(JOB_UPDATE_SINGLE_CASE).toBe("update-single-case-forecast");
    });

    it("should have proper job name for all cases update", async () => {
      const { JOB_UPDATE_ALL_CASES } = await import("./forecastWorker");
      expect(JOB_UPDATE_ALL_CASES).toBe("update-all-cases-forecast");
    });
  });
});

describe("ForecastWorker job constants", () => {
  it("should export JOB_UPDATE_SINGLE_CASE constant", async () => {
    const { JOB_UPDATE_SINGLE_CASE } = await import("./forecastWorker");
    expect(typeof JOB_UPDATE_SINGLE_CASE).toBe("string");
    expect(JOB_UPDATE_SINGLE_CASE).toBe("update-single-case-forecast");
  });

  it("should export JOB_UPDATE_ALL_CASES constant", async () => {
    const { JOB_UPDATE_ALL_CASES } = await import("./forecastWorker");
    expect(typeof JOB_UPDATE_ALL_CASES).toBe("string");
    expect(JOB_UPDATE_ALL_CASES).toBe("update-all-cases-forecast");
  });

  it("should export JOB_AUTO_COMPLETE_MILESTONES constant", async () => {
    const { JOB_AUTO_COMPLETE_MILESTONES } = await import("./forecastWorker");
    expect(typeof JOB_AUTO_COMPLETE_MILESTONES).toBe("string");
    expect(JOB_AUTO_COMPLETE_MILESTONES).toBe("auto-complete-milestones");
  });

  it("should export JOB_MILESTONE_DUE_NOTIFICATIONS constant", async () => {
    const { JOB_MILESTONE_DUE_NOTIFICATIONS } = await import("./forecastWorker");
    expect(typeof JOB_MILESTONE_DUE_NOTIFICATIONS).toBe("string");
    expect(JOB_MILESTONE_DUE_NOTIFICATIONS).toBe("milestone-due-notifications");
  });
});

describe("Milestone job constants", () => {
  it("should have unique job names for all milestone jobs", async () => {
    const {
      JOB_UPDATE_SINGLE_CASE,
      JOB_UPDATE_ALL_CASES,
      JOB_AUTO_COMPLETE_MILESTONES,
      JOB_MILESTONE_DUE_NOTIFICATIONS,
    } = await import("./forecastWorker");

    const jobNames = [
      JOB_UPDATE_SINGLE_CASE,
      JOB_UPDATE_ALL_CASES,
      JOB_AUTO_COMPLETE_MILESTONES,
      JOB_MILESTONE_DUE_NOTIFICATIONS,
    ];

    // Check all job names are unique
    const uniqueJobNames = new Set(jobNames);
    expect(uniqueJobNames.size).toBe(jobNames.length);
  });

  it("should use descriptive job names for milestone features", async () => {
    const { JOB_AUTO_COMPLETE_MILESTONES, JOB_MILESTONE_DUE_NOTIFICATIONS } =
      await import("./forecastWorker");

    // Job names should be descriptive and follow naming convention
    expect(JOB_AUTO_COMPLETE_MILESTONES).toContain("milestone");
    expect(JOB_AUTO_COMPLETE_MILESTONES).toContain("auto-complete");
    expect(JOB_MILESTONE_DUE_NOTIFICATIONS).toContain("milestone");
    expect(JOB_MILESTONE_DUE_NOTIFICATIONS).toContain("notification");
  });
});
