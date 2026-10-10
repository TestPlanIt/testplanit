import { beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn(async () => undefined);
let queueAvailable = true;
vi.mock("~/lib/queues", () => ({
  getForecastQueue: () => (queueAvailable ? { add } : null),
}));

import {
  enqueueCaseForecastUpdate,
  enqueueRunForecastUpdate,
} from "./forecastEnqueue";
import {
  JOB_UPDATE_RUN_FORECAST,
  JOB_UPDATE_SINGLE_CASE,
} from "~/lib/queueNames";

describe("forecast enqueues", () => {
  beforeEach(() => {
    add.mockClear();
    queueAvailable = true;
  });

  it("queues a deferred, deduplicated case refresh", async () => {
    await enqueueCaseForecastUpdate(42, "t1");
    expect(add).toHaveBeenCalledWith(
      JOB_UPDATE_SINGLE_CASE,
      { repositoryCaseId: 42, tenantId: "t1" },
      expect.objectContaining({
        delay: 5000,
        deduplication: { id: "forecast:case:t1:42", ttl: 5000 },
      })
    );
  });

  it("queues a run refresh under its own job name", async () => {
    await enqueueRunForecastUpdate(7);
    expect(add).toHaveBeenCalledWith(
      JOB_UPDATE_RUN_FORECAST,
      { testRunId: 7, tenantId: undefined },
      expect.objectContaining({
        deduplication: { id: "forecast:run:default:7", ttl: 5000 },
      })
    );
  });

  it("never throws into the writer", async () => {
    add.mockRejectedValueOnce(new Error("valkey down"));
    await expect(enqueueRunForecastUpdate(7)).resolves.toBeUndefined();
    queueAvailable = false;
    await expect(enqueueCaseForecastUpdate(1)).resolves.toBeUndefined();
  });
});
