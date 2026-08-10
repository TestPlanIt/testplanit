/**
 * Recognises the completion gate's typed rejection on the client.
 *
 * The chokepoint in app/api/model/[...path]/route.ts answers a blocked
 * complete with a real 403 carrying
 * `{ error: { code: "COMPLETE_NOT_PERMITTED", ... } }`. The ZenStack query
 * hooks surface that body in different shapes depending on how the failure
 * propagates, so match on the code wherever it lands rather than on any one
 * wrapper.
 */
export function isCompleteNotPermittedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    error?: { code?: unknown };
    info?: { error?: { code?: unknown }; code?: unknown };
    message?: unknown;
  };

  if (candidate.code === "COMPLETE_NOT_PERMITTED") return true;
  if (candidate.error?.code === "COMPLETE_NOT_PERMITTED") return true;
  if (candidate.info?.code === "COMPLETE_NOT_PERMITTED") return true;
  if (candidate.info?.error?.code === "COMPLETE_NOT_PERMITTED") return true;

  return (
    typeof candidate.message === "string" &&
    candidate.message.includes("COMPLETE_NOT_PERMITTED")
  );
}
