import type {
  DispatchCapability,
  DispatchRequest,
  DispatchResult,
  ExternalStatus,
  WorkflowChoice,
} from "../types";

/**
 * One implementation per CI provider. Adapters are stateless beyond the
 * credentials and settings they are constructed with, and never log or throw
 * with a credential in the message.
 */
export abstract class CiDispatchAdapter {
  /** Whether `getStatus` can be called after a dispatch. */
  abstract readonly supportsStatusPolling: boolean;

  /** Start the job. Throws `DispatchError` with a user-safe message on failure. */
  abstract dispatch(req: DispatchRequest): Promise<DispatchResult>;

  /** Current state of a previously dispatched job. */
  abstract getStatus(externalRunId: string): Promise<ExternalStatus>;

  /** Cheap read-only check that the target is reachable and usable. */
  abstract testDispatchCapability(
    workflowRef?: string | null
  ): Promise<DispatchCapability>;

  /** Discovery for the settings UI; providers without workflow files return []. */
  async listWorkflows(): Promise<WorkflowChoice[]> {
    return [];
  }

  /** Best-effort; providers that cannot cancel simply resolve. */
  async cancel(_externalRunId: string): Promise<void> {
    return;
  }
}

export class DispatchError extends Error {
  constructor(
    message: string,
    public readonly code:
      "AUTH" | "NOT_FOUND" | "INPUTS" | "PROVIDER" | "NETWORK" | "BLOCKED"
  ) {
    super(message);
    this.name = "DispatchError";
  }
}

export class StatusUnsupportedError extends Error {
  constructor() {
    super("This provider does not report job status");
    this.name = "StatusUnsupportedError";
  }
}
