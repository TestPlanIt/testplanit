/**
 * Thrown from a progress callback to stop a ticket scan the user cancelled.
 * Lives apart from the scan engine so callers that mock the engine still
 * share the one class `instanceof` checks against.
 */
export class IssueScanCancelledError extends Error {
  constructor() {
    super("Ticket scan cancelled");
    this.name = "IssueScanCancelledError";
  }
}
