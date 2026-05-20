"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { usePathname, useRouter } from "~/lib/navigation";

/**
 * Surface A.4 — URL is the source of truth for which iteration is active.
 *
 * `?iteration=N` is 1-indexed (matches the visible ordinal). The zero-indexed
 * `rowIndex` used everywhere on the server is `N - 1`. Default on first mount
 * is `1` (= rowIndex 0). Updates use `router.replace` with `scroll: false` so
 * the browser back-button still walks through previously-active iterations
 * (ITER-09 success criterion).
 */
export function useActiveIterationFromUrl(): {
  activeRowIndex: number;
  setActiveRowIndex: (rowIndex: number) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const raw = searchParams.get("iteration");
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const oneIndexed = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const activeRowIndex = oneIndexed - 1;

  const setActiveRowIndex = useCallback(
    (rowIndex: number) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set("iteration", String(rowIndex + 1));
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return { activeRowIndex, setActiveRowIndex };
}

export default useActiveIterationFromUrl;
