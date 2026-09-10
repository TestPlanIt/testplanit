import { signGenericHmac } from "~/lib/webhooks/adapters/generic-hmac";
import { assertOutboundUrlAllowed, ciRequest, CiRequestError } from "../http";
import type {
  DispatchCapability,
  DispatchRequest,
  DispatchResult,
  ExternalStatus,
} from "../types";
import {
  CiDispatchAdapter,
  DispatchError,
  StatusUnsupportedError,
} from "./CiDispatchAdapter";

export const GENERIC_EXECUTE_EVENT = "test_run.execute";

export interface GenericWebhookPayload {
  event: typeof GENERIC_EXECUTE_EVENT;
  executionId: number;
  runId: number;
  projectId: number;
  ref: string | null;
  planUrl: string;
  appUrl: string;
  inputs: Record<string, string>;
  requestedAt: string;
}

/**
 * Signed HTTP trigger for anything that is not a first-class provider
 * (Jenkins, Buildkite, a home-grown runner). The receiver verifies
 * `X-TestPlanIt-Signature` (HMAC-SHA256 over `<ts>.<body>`, same scheme as
 * outbound webhooks), starts whatever it likes, and reports back through the
 * normal results path. A 2xx means "accepted"; an optional JSON body may
 * carry `externalRunId` / `externalUrl` for the status chip.
 */
export class GenericWebhookDispatchAdapter extends CiDispatchAdapter {
  readonly supportsStatusPolling = false;

  constructor(
    private readonly url: string,
    private readonly secret: string,
    private readonly nowFn: () => number = Date.now
  ) {
    super();
  }

  async dispatch(req: DispatchRequest): Promise<DispatchResult> {
    const payload: GenericWebhookPayload = {
      event: GENERIC_EXECUTE_EVENT,
      executionId: req.executionId,
      runId: req.runId,
      projectId: req.projectId,
      ref: req.ref,
      planUrl: req.planUrl,
      appUrl: req.appUrl,
      inputs: req.inputs,
      requestedAt: new Date(this.nowFn()).toISOString(),
    };
    const body = JSON.stringify(payload);
    let response;
    try {
      response = await ciRequest(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TestPlanIt-Execution/1.0",
          "X-TestPlanIt-Event": GENERIC_EXECUTE_EVENT,
          "X-TestPlanIt-Signature": signGenericHmac(
            body,
            this.secret,
            null,
            this.nowFn
          ),
        },
        body,
        timeoutMs: 10_000,
      });
    } catch (err) {
      throw toDispatchError(err);
    }
    if (!response.ok) {
      throw new DispatchError(
        `The webhook endpoint rejected the request (HTTP ${response.status})`,
        response.status === 401 || response.status === 403 ? "AUTH" : "PROVIDER"
      );
    }
    const parsed = response.json<{
      externalRunId?: string | number;
      externalUrl?: string;
      jobs?: Record<string, { triggered?: boolean }>;
    }>();
    const result: DispatchResult = {};
    if (parsed && parsed.externalRunId != null) {
      result.externalRunId = String(parsed.externalRunId).slice(0, 200);
    }
    if (parsed && typeof parsed.externalUrl === "string") {
      try {
        const u = new URL(parsed.externalUrl);
        if (u.protocol === "http:" || u.protocol === "https:") {
          result.externalUrl = parsed.externalUrl.slice(0, 2000);
        }
      } catch {
        // ignore unparsable URLs
      }
    }
    if (!result.externalUrl && parsed?.jobs) {
      // Jenkins' Generic Webhook Trigger answers {"jobs":{"<name>":{triggered,
      // id, url:"queue/item/N/"}}}. The queue item disappears once the build
      // starts, so link to the job page, which lists the build.
      const triggered = Object.entries(parsed.jobs).find(
        ([, job]) => job && job.triggered
      );
      if (triggered) {
        const [name] = triggered;
        const origin = new URL(this.url).origin;
        result.externalUrl = `${origin}/job/${encodeURIComponent(name)}/`;
      }
    }
    return result;
  }

  async getStatus(_externalRunId: string): Promise<ExternalStatus> {
    throw new StatusUnsupportedError();
  }

  async testDispatchCapability(): Promise<DispatchCapability> {
    try {
      assertOutboundUrlAllowed(this.url);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Invalid URL",
        warnings: [],
      };
    }
    if (!this.secret) {
      return { ok: false, error: "A signing secret is required", warnings: [] };
    }
    return {
      ok: true,
      warnings: [
        "A generic webhook can only be proven to work by a real dispatch; the endpoint must return 2xx to accept it.",
      ],
    };
  }
}

function toDispatchError(err: unknown): DispatchError {
  if (err instanceof CiRequestError) {
    return new DispatchError(
      err.message,
      err.code === "BLOCKED" ? "BLOCKED" : "NETWORK"
    );
  }
  return new DispatchError(
    err instanceof Error ? err.message : "Dispatch failed",
    "NETWORK"
  );
}
