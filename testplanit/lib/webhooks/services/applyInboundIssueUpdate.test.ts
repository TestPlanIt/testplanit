import type { AdapterType } from "~/zenstack/models";
import { ORMError } from "@zenstackhq/orm";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplyInboundIssueUpdateInput } from "./types";

/**
 * Hoisted mocks for `prisma`, `captureAuditEvent`, `isUniqueConstraintError`,
 * and `getAdapter` (service-side extractor delegation).
 *
 * Each test mutates the per-call return values via `mocks.tx.*` setters; the same
 * `tx` object is yielded from every `prisma.$transaction(fn)` invocation so we can
 * spy on the per-model calls (`webhookDelivery.create/update`, `webhookEventDedup.create`,
 * `issue.findFirst`, `issue.update`, `webhookConfig.update`).
 *
 * The `adapter` mock holds the extractor stubs; tests override its return values
 * to inject linkedRef + externalStatus values per scenario.
 */
const mocks = vi.hoisted(() => {
  const tx = {
    webhookDelivery: {
      create: vi.fn(),
      update: vi.fn(),
    },
    webhookEventDedup: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    issue: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    webhookConfig: {
      update: vi.fn(),
    },
  };
  const $transaction = vi.fn(async (fn: any) => fn(tx));
  // Used by the post-commit `triggerSystemSyncForInboundEvent` to resolve
  // the project's active integration. Default: null so the sync trigger
  // logs a warning and short-circuits — keeps the inbound-apply tests
  // focused on the receipt + dedup behavior, not on sync wiring.
  const projectIntegrationFindFirst = vi.fn(async () => null);
  const adapter = {
    adapterType: "JIRA" as AdapterType,
    verify: vi.fn(),
    extractLinkedIssueRef: vi.fn(),
    extractExternalStatus: vi.fn(),
  };
  const getAdapter = vi.fn(() => adapter);
  // System-context sync — invoked post-commit on the 'updated' outcome
  // when an active matching integration exists. Stub returns success;
  // tests that care about the trigger override per-test.
  const performIssueRefreshSystem = vi.fn(async () => ({ success: true }));
  return {
    tx,
    prisma: {
      $transaction,
      projectIntegration: { findFirst: projectIntegrationFindFirst },
    },
    captureAuditEvent: vi.fn(async () => undefined),
    isUniqueConstraintError: vi.fn((err: unknown) => {
      return (
        err instanceof ORMError &&
        err.code === "P2002"
      );
    }),
    adapter,
    getAdapter,
    syncService: { performIssueRefreshSystem },
    performIssueRefreshSystem,
    projectIntegrationFindFirst,
  };
});

vi.mock("~/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("~/lib/services/auditLog", () => ({
  captureAuditEvent: mocks.captureAuditEvent,
}));

vi.mock("~/lib/utils/errors", () => ({
  isUniqueConstraintError: mocks.isUniqueConstraintError,
}));

vi.mock("~/lib/webhooks/adapters", () => ({
  getAdapter: mocks.getAdapter,
}));

vi.mock("~/lib/integrations/services/SyncService", () => ({
  syncService: mocks.syncService,
}));

// Defer the import of the SUT until after the mocks are wired up so that the
// service's module-level imports resolve to the mocked modules.
const importSut = async () =>
  (await import("./applyInboundIssueUpdate")).applyInboundIssueUpdate;

const RECEIVED_AT = new Date("2026-04-26T20:00:00.000Z");

const baseInput = (
  overrides: Partial<ApplyInboundIssueUpdateInput> = {}
): ApplyInboundIssueUpdateInput => ({
  webhookConfigId: "wc_demo",
  projectId: 7,
  adapterType: "JIRA",
  eventType: "jira:issue_updated",
  payload: {
    eventType: "jira:issue_updated",
    issueKey: "DEMO-42",
    externalStatus: "In Progress",
    synthetic: false,
  },
  payloadDigest: "deadbeef".padEnd(64, "0"),
  receivedAt: RECEIVED_AT,
  latencyMs: 12,
  statusCode: 200,
  ...overrides,
});

const resetTxMocks = () => {
  for (const model of Object.values(mocks.tx)) {
    for (const fn of Object.values(model)) {
      (fn as ReturnType<typeof vi.fn>).mockReset();
    }
  }
  mocks.prisma.$transaction.mockClear();
  mocks.prisma.$transaction.mockImplementation(async (fn: any) => fn(mocks.tx));
  mocks.captureAuditEvent.mockReset();
  mocks.captureAuditEvent.mockResolvedValue(undefined);
  // Default: webhookDelivery.create returns a stable id.
  mocks.tx.webhookDelivery.create.mockResolvedValue({ id: "del_1" });
  mocks.tx.webhookDelivery.update.mockResolvedValue({});
  mocks.tx.webhookConfig.update.mockResolvedValue({});
  mocks.tx.issue.update.mockResolvedValue({});
  mocks.tx.webhookEventDedup.create.mockResolvedValue({});
  mocks.tx.webhookEventDedup.delete.mockResolvedValue({});
  // Default: no prior dedup row (the SELECT pattern's "first time" path).
  // Tests that exercise the duplicate path override this to return a row.
  mocks.tx.webhookEventDedup.findFirst.mockResolvedValue(null);
  mocks.tx.issue.findFirst.mockResolvedValue(null);
  // Reset the post-commit sync trigger mocks between tests — these are
  // shared singletons from `vi.hoisted` and will accumulate calls across
  // the suite otherwise.
  mocks.projectIntegrationFindFirst.mockReset();
  mocks.projectIntegrationFindFirst.mockResolvedValue(null);
  mocks.performIssueRefreshSystem.mockReset();
  mocks.performIssueRefreshSystem.mockResolvedValue({ success: true });
  mocks.isUniqueConstraintError.mockImplementation((err: unknown) => {
    return (
      err instanceof ORMError &&
      err.code === "P2002"
    );
  });
  // Adapter mock defaults: extract linkedRef from baseInput's Jira-shaped
  // payload (DEMO-42, JIRA) and externalStatus "In Progress". Each test
  // overrides as needed.
  (mocks.adapter.extractLinkedIssueRef as Mock).mockReset();
  (mocks.adapter.extractLinkedIssueRef as Mock).mockReturnValue({
    externalKey: "DEMO-42",
    externalSystem: "JIRA",
  });
  (mocks.adapter.extractExternalStatus as Mock).mockReset();
  (mocks.adapter.extractExternalStatus as Mock).mockReturnValue("In Progress");
  mocks.getAdapter.mockClear();
  mocks.getAdapter.mockReturnValue(mocks.adapter);
};

describe("applyInboundIssueUpdate", () => {
  beforeEach(() => {
    resetTxMocks();
  });

  it("Test 1: synthetic short-circuit (no prior dedup) writes dedup INSIDE synthetic branch and never touches Issue", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput({
      payload: {
        eventType: "jira:issue_updated",
        issueKey: "SYN-1",
        externalStatus: "ignored",
        synthetic: true,
      },
    });

    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("synthetic");
    expect(result.deliveryId).toBe("del_1");
    // Issue lookup MUST NOT be called when synthetic.
    expect(mocks.tx.issue.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Dedup INSERT IS called (so a second click can collide).
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledWith({
      data: {
        webhookConfigId: input.webhookConfigId,
        payloadDigest: input.payloadDigest,
        processedAt: input.receivedAt,
      },
    });
    // Delivery row finalized error='synthetic'.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "synthetic",
      },
    });
    // WebhookConfig.lastReceivedAt updated.
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: input.webhookConfigId },
      data: { lastReceivedAt: input.receivedAt },
    });
    // Audit emitted with synthetic outcome.
    expect(mocks.captureAuditEvent).toHaveBeenCalledTimes(1);
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        entityType: "WebhookDelivery",
        entityId: "del_1",
        userId: "__system__",
        metadata: expect.objectContaining({ outcome: "synthetic" }),
      })
    );
  });

  it("Test 1b: synthetic-then-synthetic = duplicate", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput({
      payload: {
        eventType: "jira:issue_updated",
        issueKey: "SYN-1",
        externalStatus: "ignored",
        synthetic: true,
      },
    });

    // First synthetic call: dedup INSERT succeeds → outcome 'synthetic'.
    const first = await applyInboundIssueUpdate(input);
    expect(first.outcome).toBe("synthetic");

    // Reset only call counts; keep mock implementations the same except the dedup SELECT.
    mocks.tx.webhookDelivery.create.mockClear();
    mocks.tx.webhookDelivery.update.mockClear();
    mocks.tx.webhookConfig.update.mockClear();
    mocks.tx.issue.findFirst.mockClear();
    mocks.tx.issue.update.mockClear();
    mocks.tx.webhookEventDedup.create.mockClear();
    mocks.tx.webhookEventDedup.findFirst.mockClear();
    mocks.captureAuditEvent.mockClear();
    mocks.tx.webhookDelivery.create.mockResolvedValue({ id: "del_2" });
    // Second synthetic call: priorDedup SELECT returns the row from click 1 → outcome 'duplicate'.
    mocks.tx.webhookEventDedup.findFirst.mockResolvedValueOnce({
      id: "dedup_1",
    });

    // Second synthetic call: priorDedup detected → outcome 'duplicate'.
    const second = await applyInboundIssueUpdate(input);
    expect(second.outcome).toBe("duplicate");
    expect(second.deliveryId).toBe("del_2");
    // No Issue mutation.
    expect(mocks.tx.issue.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Delivery row finalized error='duplicate'.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_2" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "duplicate",
      },
    });
    // Audit emitted with duplicate outcome.
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        metadata: expect.objectContaining({ outcome: "duplicate" }),
      })
    );
  });

  it("Test 2: linked-Issue duplicate (priorDedup detected) — fresh delivery row, no Issue mutation, attempt=1", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 99 });
    // priorDedup SELECT returns a row → linked-Issue branch detects duplicate.
    mocks.tx.webhookEventDedup.findFirst.mockResolvedValueOnce({
      id: "dedup_1",
    });

    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("duplicate");
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Fresh delivery row was created (attempt=1 — duplicates distinguishable by error, NOT attempt).
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ attempt: 1 }),
      })
    );
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "duplicate",
      },
    });
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: "duplicate" }),
      })
    );
  });

  it("Test 3: linked-but-missing Issue triggers auto-create — dedup INSERTED, outcome 'updated' with wasAutoCreated metadata, post-commit sync called with createIfMissing", async () => {
    // The legacy "no-link skip-dedup, retry-after-manual-link" semantics
    // retired in favor of auto-create. When the adapter extracts
    // a linkedRef and the local Issue lookup misses, the receiver now
    // creates the Issue row from upstream state on this first receipt.
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    // Tx-side lookup returns null (Issue doesn't exist locally).
    mocks.tx.issue.findFirst.mockResolvedValue(null);
    mocks.projectIntegrationFindFirst.mockResolvedValueOnce({
      integrationId: 42,
      integration: { id: 42 },
    } as any);

    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("updated");
    // Dedup IS written so the next redelivery of the same payload
    // resolves as 'duplicate' rather than re-creating.
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookEventDedup.delete).not.toHaveBeenCalled();
    // Delivery row finalized with error=null (apply succeeded).
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: null,
      },
    });
    // Audit metadata records the auto-create distinction so the
    // Deliveries tab / report layer can differentiate later.
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        metadata: expect.objectContaining({
          outcome: "updated",
          wasAutoCreated: true,
          issueKey: "DEMO-42",
        }),
      })
    );
    // Post-commit sync called with createIfMissing scoped to the project.
    expect(mocks.performIssueRefreshSystem).toHaveBeenCalledWith(
      42,
      "DEMO-42",
      expect.objectContaining({
        minFreshnessSeconds: 15,
        createIfMissing: { projectId: input.projectId },
      })
    );
  });

  it("Test 4: happy path — Issue lookup uses externalKey+projectId+isDeleted (NO externalSystem filter), getAdapter called with adapterType, all six writes present", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    const result = await applyInboundIssueUpdate(input);

    expect(result).toEqual({
      outcome: "updated",
      deliveryId: "del_1",
      issueId: 100,
    });
    // Adapter resolved by service via getAdapter(input.adapterType).
    expect(mocks.getAdapter).toHaveBeenCalledWith("JIRA");
    expect(mocks.adapter.extractLinkedIssueRef).toHaveBeenCalledWith(
      input.payload
    );
    expect(mocks.adapter.extractExternalStatus).toHaveBeenCalledWith(
      input.payload,
      input.eventType
    );
    // 1. Delivery row created.
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledTimes(1);
    // 2. Linked Issue lookup with tenant scope — NO externalSystem filter.
    expect(mocks.tx.issue.findFirst).toHaveBeenCalledWith({
      where: {
        externalKey: "DEMO-42",
        isDeleted: false,
        project: { id: input.projectId },
      },
      select: { id: true },
    });
    const findFirstCall = mocks.tx.issue.findFirst.mock.calls[0]?.[0];
    expect(findFirstCall.where).not.toHaveProperty("externalSystem");
    // 3. Dedup INSERT.
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledWith({
      data: {
        webhookConfigId: input.webhookConfigId,
        payloadDigest: input.payloadDigest,
        processedAt: input.receivedAt,
      },
    });
    // 4. Issue mutation now happens POST-commit via the system sync path.
    // The transaction itself MUST NOT touch the Issue row (the
    // performIssueRefreshSystem call is wired AFTER tx commits — see
    // applyInboundIssueUpdate.ts post-audit block).
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // 5. Delivery row finalized error=null.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: null,
      },
    });
    // 6. WebhookConfig.lastReceivedAt updated.
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: input.webhookConfigId },
      data: { lastReceivedAt: input.receivedAt },
    });
  });

  it("Test 5: atomicity — dedup INSERT throws → tx rolls back, no audit, returns error", async () => {
    // The Issue mutation moved to the post-commit sync path (see
    // applyInboundIssueUpdate.ts). The remaining write that can fail INSIDE
    // the tx for the linked-Issue happy path is `webhookEventDedup.create`
    // (e.g. unique-constraint loss against a concurrent receipt). Verify
    // the same rollback contract: when ANY tx step throws, no audit fires
    // and the public outcome is "error".
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    const txError = new Error("Connection lost mid-transaction");
    mocks.tx.webhookEventDedup.create.mockRejectedValueOnce(txError);
    mocks.prisma.$transaction.mockImplementationOnce(async (fn: any) =>
      fn(mocks.tx)
    );

    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("Connection lost mid-transaction");
    expect(mocks.captureAuditEvent).not.toHaveBeenCalled();
    // Sync trigger MUST NOT fire when the tx rolled back.
    expect(mocks.performIssueRefreshSystem).not.toHaveBeenCalled();
  });

  it("Test 6: post-commit sync triggers for the 'updated' outcome — calls performIssueRefreshSystem with webhook freshness window", async () => {
    // The inbound handler no longer caps the apply at externalStatus +
    // lastSyncedAt. It now delegates the local Issue
    // mutation to `performIssueRefreshSystem`, which pulls full upstream
    // state and applies the integration's field mappings (matches the
    // manual sync click). Test that the trigger fires with the right
    // integration ID, externalKey, and freshness window.
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    mocks.projectIntegrationFindFirst.mockResolvedValueOnce({
      integrationId: 42,
      integration: { id: 42 },
    } as any);

    await applyInboundIssueUpdate(input);

    expect(mocks.performIssueRefreshSystem).toHaveBeenCalledTimes(1);
    expect(mocks.performIssueRefreshSystem).toHaveBeenCalledWith(
      42, // integration.id from the resolved ProjectIntegration
      "DEMO-42", // linkedRef.externalKey
      { minFreshnessSeconds: 15 } // WEBHOOK_SYNC_FRESHNESS_SECONDS
    );
  });

  it("Test 7: audit metadata shape — WEBHOOK_RECEIVED with full metadata, adapterType comes from input (not hardcoded)", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    await applyInboundIssueUpdate(input);

    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        entityType: "WebhookDelivery",
        entityId: "del_1",
        projectId: input.projectId,
        userId: "__system__",
        metadata: {
          adapterType: "JIRA",
          eventType: input.eventType,
          payloadDigest: input.payloadDigest,
          webhookConfigId: input.webhookConfigId,
          outcome: "updated",
          issueId: 100,
        },
      })
    );
  });

  it("Test 8: audit emission is awaited — service waits for captureAuditEvent before resolving", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    let auditResolve!: () => void;
    const auditDeferred = new Promise<void>((resolve) => {
      auditResolve = resolve;
    });
    let auditCalled = false;
    mocks.captureAuditEvent.mockImplementationOnce(async () => {
      auditCalled = true;
      await auditDeferred;
    });

    let serviceResolved = false;
    const servicePromise = applyInboundIssueUpdate(input).then((r) => {
      serviceResolved = true;
      return r;
    });

    // Yield to the microtask queue so the service awaits captureAuditEvent.
    await new Promise((r) => setTimeout(r, 5));
    expect(auditCalled).toBe(true);
    expect(serviceResolved).toBe(false); // service has NOT resolved while audit is pending

    auditResolve();
    const result = await servicePromise;
    expect(serviceResolved).toBe(true);
    expect(result.outcome).toBe("updated");
  });

  it("Test 9: audit entityType=WebhookDelivery, entityId=delivery cuid", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.webhookDelivery.create.mockResolvedValueOnce({ id: "del_xyz" });
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    await applyInboundIssueUpdate(input);

    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "WebhookDelivery",
        entityId: "del_xyz",
      })
    );
  });

  it("Test 10: delivery row column completeness (direction, adapterType, eventType, payloadDigest)", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });

    await applyInboundIssueUpdate(input);

    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        webhookConfigId: input.webhookConfigId,
        direction: "INBOUND",
        adapterType: "JIRA",
        eventType: input.eventType,
        payloadDigest: input.payloadDigest,
        attempt: 1,
        receivedAt: input.receivedAt,
      }),
    });
  });

  it("Test 12: non-P2002 error from dedup INSERT → outcome 'error', not 'duplicate'", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    // Simulate a non-P2002 error (e.g., connection timeout).
    const connTimeout = new Error("ECONNRESET: connection reset");
    mocks.tx.webhookEventDedup.create.mockRejectedValueOnce(connTimeout);

    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("error");
    expect(result.reason).toContain("ECONNRESET");
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    expect(mocks.captureAuditEvent).not.toHaveBeenCalled();
  });

  it("Test 13: redelivery of an auto-created issue's first payload resolves as 'duplicate' (not a second auto-create)", async () => {
    // Auto-create writes the dedup row on the first receipt. A redelivery
    // of the SAME payload (Jira/GitHub retry on transient 5xx, or admin
    // re-firing the same event) must NOT spawn a second Issue — the dedup
    // SELECT catches it and returns 'duplicate'. The original
    // skip-dedup behavior (which existed precisely so a retry-after-link
    // would re-apply) is no longer needed: auto-create resolves the link
    // on the first receipt.
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();

    // First call — linked-but-missing → auto-create.
    mocks.tx.issue.findFirst.mockResolvedValueOnce(null);
    const first = await applyInboundIssueUpdate(input);
    expect(first.outcome).toBe("updated");
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);

    // Second call — same payloadDigest, dedup row from the first call is
    // now present → 'duplicate' outcome, no second dedup INSERT, no second
    // post-commit sync.
    mocks.tx.webhookDelivery.create.mockResolvedValueOnce({ id: "del_2" });
    mocks.tx.webhookEventDedup.findFirst.mockResolvedValueOnce({
      id: "dedup_existing",
    });
    mocks.tx.issue.findFirst.mockResolvedValueOnce({ id: 200 });
    const second = await applyInboundIssueUpdate(input);
    expect(second.outcome).toBe("duplicate");
    expect(mocks.tx.webhookEventDedup.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
  });

  it("Test 14: GitHub adapter happy path — adapterType + audit metadata parametrized via input.adapterType", async () => {
    const applyInboundIssueUpdate = await importSut();
    // Override adapter mock for GitHub: extractors yield `octocat/Hello-World#42` + "open".
    (mocks.adapter.extractLinkedIssueRef as Mock).mockReturnValueOnce({
      externalKey: "octocat/Hello-World#42",
      externalSystem: "GITHUB",
    });
    (mocks.adapter.extractExternalStatus as Mock).mockReturnValueOnce("open");
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 99 });

    const input = baseInput({
      adapterType: "GITHUB",
      eventType: "issues",
      payload: { eventType: "issues" } as any,
    });
    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("updated");
    expect(result.issueId).toBe(99);
    // getAdapter resolved by parametrized type.
    expect(mocks.getAdapter).toHaveBeenCalledWith("GITHUB");
    // WebhookDelivery row's adapterType column is GITHUB (not hardcoded JIRA).
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adapterType: "GITHUB",
        direction: "INBOUND",
        eventType: "issues",
      }),
    });
    // Audit metadata adapterType=GITHUB.
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          adapterType: "GITHUB",
          eventType: "issues",
          outcome: "updated",
          issueId: 99,
        }),
      })
    );
    // Issue lookup uses externalKey from adapter.extractLinkedIssueRef (NOT payload.issueKey).
    expect(mocks.tx.issue.findFirst).toHaveBeenCalledWith({
      where: {
        externalKey: "octocat/Hello-World#42",
        isDeleted: false,
        project: { id: input.projectId },
      },
      select: { id: true },
    });
  });

  it("Test 15: ADO adapter happy path — adapterType=AZURE_DEVOPS plumbed end-to-end", async () => {
    const applyInboundIssueUpdate = await importSut();
    (mocks.adapter.extractLinkedIssueRef as Mock).mockReturnValueOnce({
      externalKey: "297",
      externalSystem: "AZURE_DEVOPS",
    });
    (mocks.adapter.extractExternalStatus as Mock).mockReturnValueOnce("Closed");
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 297 });

    const input = baseInput({
      adapterType: "AZURE_DEVOPS",
      eventType: "workitem.updated",
      payload: { eventType: "workitem.updated" } as any,
    });
    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("updated");
    expect(mocks.getAdapter).toHaveBeenCalledWith("AZURE_DEVOPS");
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adapterType: "AZURE_DEVOPS",
        eventType: "workitem.updated",
      }),
    });
    // Issue mutation moved to post-commit sync (see Test 6); the tx
    // itself never touches the Issue row.
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          adapterType: "AZURE_DEVOPS",
        }),
      })
    );
  });

  it("Test 16: no_handler skip — extractExternalStatus returns null → delivery row written, no dedup, no Issue lookup, no Issue mutation", async () => {
    const applyInboundIssueUpdate = await importSut();
    // Adapter returns null status (e.g., GitHub `push` event — no status to apply).
    (mocks.adapter.extractExternalStatus as Mock).mockReturnValueOnce(null);
    // linkedRef may still be returned; the no_handler branch fires first.
    (mocks.adapter.extractLinkedIssueRef as Mock).mockReturnValueOnce({
      externalKey: "octocat/Hello-World#42",
      externalSystem: "GITHUB",
    });

    const input = baseInput({
      adapterType: "GITHUB",
      eventType: "push",
      payload: { eventType: "push" } as any,
    });
    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("no_handler");
    expect(result.deliveryId).toBe("del_1");
    // Delivery row created (error finalized in subsequent update — consistent
    // with the existing create-then-update pattern for all outcomes).
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adapterType: "GITHUB",
        direction: "INBOUND",
        eventType: "push",
      }),
    });
    // Delivery row finalized error='no_handler'.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "no_handler",
      },
    });
    // No Issue lookup, no Issue mutation.
    expect(mocks.tx.issue.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Dedup table NEVER touched (mirrors no-link precedent).
    expect(mocks.tx.webhookEventDedup.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.webhookEventDedup.create).not.toHaveBeenCalled();
    expect(mocks.tx.webhookEventDedup.delete).not.toHaveBeenCalled();
    // lastReceivedAt still bumped — every accepted receipt counts.
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: input.webhookConfigId },
      data: { lastReceivedAt: input.receivedAt },
    });
    // Audit emitted with no_handler outcome.
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WEBHOOK_RECEIVED",
        metadata: expect.objectContaining({
          outcome: "no_handler",
          adapterType: "GITHUB",
        }),
      })
    );
  });

  it("Test 17: no-link upfront — extractLinkedIssueRef returns null → delivery row written, no dedup, no Issue lookup", async () => {
    const applyInboundIssueUpdate = await importSut();
    // Adapter cannot extract a linked ref (e.g., GitHub issues event lacking
    // repository.full_name); externalStatus is non-null (a real status).
    (mocks.adapter.extractLinkedIssueRef as Mock).mockReturnValueOnce(null);
    (mocks.adapter.extractExternalStatus as Mock).mockReturnValueOnce("open");

    const input = baseInput({
      adapterType: "GITHUB",
      eventType: "issues",
      payload: { eventType: "issues" } as any,
    });
    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("no-link");
    // Delivery row created (error finalized in subsequent update).
    expect(mocks.tx.webhookDelivery.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        adapterType: "GITHUB",
        direction: "INBOUND",
        eventType: "issues",
      }),
    });
    // Delivery row finalized error='no-link'.
    expect(mocks.tx.webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: "del_1" },
      data: {
        statusCode: input.statusCode,
        latencyMs: input.latencyMs,
        error: "no-link",
      },
    });
    // Issue lookup is NEVER called when adapter can't even produce a key.
    expect(mocks.tx.issue.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.issue.update).not.toHaveBeenCalled();
    // Dedup table NEVER touched (mirrors the existing no-link semantics).
    expect(mocks.tx.webhookEventDedup.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.webhookEventDedup.create).not.toHaveBeenCalled();
    // lastReceivedAt still bumped.
    expect(mocks.tx.webhookConfig.update).toHaveBeenCalledWith({
      where: { id: input.webhookConfigId },
      data: { lastReceivedAt: input.receivedAt },
    });
    // Audit emitted with no-link outcome.
    expect(mocks.captureAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          outcome: "no-link",
          adapterType: "GITHUB",
        }),
      })
    );
  });

  it("Test 18: audit metadata adapterType is parametrized (not hardcoded JIRA) — GitHub call captures adapterType=GITHUB", async () => {
    const applyInboundIssueUpdate = await importSut();
    (mocks.adapter.extractLinkedIssueRef as Mock).mockReturnValueOnce({
      externalKey: "octocat/Hello-World#42",
      externalSystem: "GITHUB",
    });
    (mocks.adapter.extractExternalStatus as Mock).mockReturnValueOnce("open");
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 99 });

    const input = baseInput({
      adapterType: "GITHUB",
      eventType: "issues",
      payload: { eventType: "issues" } as any,
    });
    await applyInboundIssueUpdate(input);

    const auditCall = (
      mocks.captureAuditEvent.mock.calls[0] as unknown as
        | [{ metadata?: { adapterType?: AdapterType } }]
        | undefined
    )?.[0];
    expect(auditCall?.metadata?.adapterType).toBe("GITHUB");
    // Sanity: ensure JIRA is NOT in the metadata for this GitHub call.
    expect(auditCall?.metadata?.adapterType).not.toBe("JIRA");
  });

  // ===========================================================================
  // Post-commit system-sync trigger — ensures the inbound webhook → full sync
  // wiring fires only on the 'updated' outcome, scopes to the project's
  // active matching integration, and survives sync failures gracefully.
  // ===========================================================================

  it("Test 19: sync trigger filters by integration provider — Jira webhook on a project with only a GitHub integration is skipped", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    // Default mock returns null — simulates "no JIRA integration matches".
    // The trigger logs and short-circuits without calling SyncService.

    const result = await applyInboundIssueUpdate(input);

    expect(result.outcome).toBe("updated");
    expect(mocks.projectIntegrationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: input.projectId,
          isActive: true,
          integration: { provider: "JIRA", isDeleted: false },
        }),
      })
    );
    expect(mocks.performIssueRefreshSystem).not.toHaveBeenCalled();
  });

  it("Test 20: sync trigger DOES NOT fire on no-link, no_handler, duplicate, or synthetic outcomes", async () => {
    const applyInboundIssueUpdate = await importSut();

    // no-link: linkedRef=null
    (mocks.adapter.extractLinkedIssueRef as Mock).mockReturnValueOnce(null);
    await applyInboundIssueUpdate(baseInput());
    expect(mocks.performIssueRefreshSystem).not.toHaveBeenCalled();

    // no_handler: externalStatus=null
    (mocks.adapter.extractExternalStatus as Mock).mockReturnValueOnce(null);
    await applyInboundIssueUpdate(baseInput());
    expect(mocks.performIssueRefreshSystem).not.toHaveBeenCalled();

    // duplicate: priorDedup row exists
    mocks.tx.webhookEventDedup.findFirst.mockResolvedValueOnce({ id: "x" });
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    await applyInboundIssueUpdate(baseInput());
    expect(mocks.performIssueRefreshSystem).not.toHaveBeenCalled();

    // synthetic: payload.synthetic=true
    await applyInboundIssueUpdate(
      baseInput({
        payload: {
          eventType: "jira:issue_updated",
          issueKey: "DEMO-42",
          externalStatus: "In Progress",
          synthetic: true,
        },
      })
    );
    expect(mocks.performIssueRefreshSystem).not.toHaveBeenCalled();
  });

  it("Test 21: sync failure is logged but does NOT change the public outcome — webhook receipt stays 'updated'", async () => {
    const applyInboundIssueUpdate = await importSut();
    const input = baseInput();
    mocks.tx.issue.findFirst.mockResolvedValue({ id: 100 });
    mocks.projectIntegrationFindFirst.mockResolvedValueOnce({
      integrationId: 42,
      integration: { id: 42 },
    } as any);
    mocks.performIssueRefreshSystem.mockResolvedValueOnce({
      success: false,
      error: "upstream 502",
    } as any);

    const result = await applyInboundIssueUpdate(input);

    // Sync failed, but the inbound apply is still 'updated' — the dedup
    // row is committed and the next webhook event will reconcile.
    expect(result.outcome).toBe("updated");
    expect(mocks.performIssueRefreshSystem).toHaveBeenCalledTimes(1);
  });
});
