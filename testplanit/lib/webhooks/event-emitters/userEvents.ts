/**
 * RED stub — implementations land in the GREEN step.
 */

export function determineScimUserUpdateEventName(
  _oldRow: { isActive: boolean },
  _newRow: { isActive: boolean }
): string {
  throw new Error("not implemented");
}

export async function emitScimUserCreated(
  _row: unknown,
  _tx: unknown,
  _opts: unknown = {}
): Promise<void> {
  throw new Error("not implemented");
}

export async function emitScimUserUpdated(
  _oldRow: unknown,
  _newRow: unknown,
  _tx: unknown,
  _opts: unknown = {}
): Promise<void> {
  throw new Error("not implemented");
}

export async function emitScimUserDeleted(
  _row: unknown,
  _tx: unknown,
  _opts: unknown = {}
): Promise<void> {
  throw new Error("not implemented");
}
