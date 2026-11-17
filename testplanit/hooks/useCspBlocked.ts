import { useSyncExternalStore } from "react";
import {
  isCspBlocked,
  subscribeToCspBlocks,
} from "~/lib/utils/cspBlockedOrigins";

/**
 * Whether the page's Content-Security-Policy has blocked a load from the host
 * that serves `url`.
 */
export function useCspBlocked(url: string): boolean {
  return useSyncExternalStore(
    subscribeToCspBlocks,
    () => isCspBlocked(url),
    () => false
  );
}
