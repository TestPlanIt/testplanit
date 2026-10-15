/**
 * Deployment-skew detection: notices when this tab runs a different build from
 * the server, and holds the flag the update banner renders from.
 *
 * A tab opened before a deploy keeps calling server actions by the old build's
 * IDs, and every call fails. Two signals feed the flag:
 * - a version check (`reportServerBuildId`) comparing the server's build ID
 *   with the one inlined into this bundle;
 * - errors only skew produces (`reportPossibleSkew`).
 *
 * A single mismatched check is not enough: during a blue-green switch one poll
 * can land on the container that has not been replaced yet. The flag is set by
 * two consecutive mismatches, by a mismatch plus a chunk-load error, or at once
 * by an unrecognized server action, which only a different build can produce.
 */

export type SkewKind = "action" | "chunk";

const ACTION_MESSAGES = [
  /Server Action ".*" was not found on the server/i,
  /Failed to find Server Action/i,
];
const CHUNK_MESSAGES = [
  /Failed to load chunk /i,
  /Loading (CSS )?chunk .+ failed/i,
];

export function classifySkewError(error: unknown): SkewKind | null {
  if (!error) return null;
  const name =
    typeof error === "object" && "name" in error ? String(error.name) : "";
  const message =
    typeof error === "string"
      ? error
      : typeof error === "object" && "message" in error
        ? String(error.message)
        : "";
  if (
    name === "UnrecognizedActionError" ||
    ACTION_MESSAGES.some((pattern) => pattern.test(message))
  ) {
    return "action";
  }
  // A chunk can also fail to load because the network dropped, so this kind
  // only counts once a version check confirms the build changed.
  if (
    name === "ChunkLoadError" ||
    CHUNK_MESSAGES.some((pattern) => pattern.test(message))
  ) {
    return "chunk";
  }
  return null;
}

export function isDeploymentSkewError(error: unknown): boolean {
  return classifySkewError(error) !== null;
}

let updateAvailable = false;
let dismissed = false;
let consecutiveMismatches = 0;
let chunkErrorPending = false;
let requestVersionCheck: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function markUpdateAvailable(reopenIfDismissed: boolean) {
  const reopen = reopenIfDismissed && dismissed;
  if (updateAvailable && !reopen) return;
  updateAvailable = true;
  dismissed = false;
  emit();
}

/** Call from any catch that swallows an error, so skew still reaches the banner. */
export function reportPossibleSkew(error: unknown): void {
  const kind = classifySkewError(error);
  if (
    kind === "action" ||
    (kind === "chunk" && (updateAvailable || consecutiveMismatches > 0))
  ) {
    markUpdateAvailable(true);
  } else if (kind === "chunk") {
    chunkErrorPending = true;
    requestVersionCheck?.();
  }
}

/**
 * Records one version check. Returns true when the server is on a different
 * build, so the caller can schedule a confirming check.
 */
export function reportServerBuildId(
  serverBuildId: string,
  clientBuildId: string | undefined = process.env.NEXT_PUBLIC_BUILD_ID
): boolean {
  if (!clientBuildId || !serverBuildId) return false;
  if (serverBuildId === clientBuildId) {
    consecutiveMismatches = 0;
    chunkErrorPending = false;
    return false;
  }
  consecutiveMismatches += 1;
  if (consecutiveMismatches >= 2 || chunkErrorPending) {
    markUpdateAvailable(false);
  }
  return true;
}

/** Hides the banner until the next skew error; later version checks keep it hidden. */
export function dismissUpdateBanner(): void {
  if (!updateAvailable || dismissed) return;
  dismissed = true;
  emit();
}

/** Whether a newer build was detected, dismissed or not. Polling can stop once it is. */
export function isUpdateAvailable(): boolean {
  return updateAvailable;
}

export function isUpdateBannerVisible(): boolean {
  return updateAvailable && !dismissed;
}

export function subscribeToUpdateBanner(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Lets a chunk error ask the watcher for an immediate version check. */
export function setVersionCheckRequester(request: () => void): () => void {
  requestVersionCheck = request;
  return () => {
    if (requestVersionCheck === request) requestVersionCheck = null;
  };
}

export function _resetForTesting(): void {
  updateAvailable = false;
  dismissed = false;
  consecutiveMismatches = 0;
  chunkErrorPending = false;
  requestVersionCheck = null;
  listeners.clear();
}
