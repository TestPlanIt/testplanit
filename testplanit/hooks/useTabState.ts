"use client";

import { useRouter, usePathname } from "~/lib/navigation";
import { useCallback, useState, useEffect, useRef } from "react";

/**
 * Custom hook to manage tab state via URL search parameters.
 * This allows tabs to persist across page refreshes and enables shareable URLs.
 *
 * Uses window.location instead of useSearchParams() to avoid Next.js re-rendering issues.
 *
 * @param paramName - The URL parameter name (default: "tab")
 * @param defaultValue - The default tab value if no parameter is present
 * @returns A tuple of [currentTab, setTab] similar to useState
 *
 * @example
 * ```tsx
 * const [activeTab, setActiveTab] = useTabState("tab", "active");
 *
 * <Tabs value={activeTab} onValueChange={setActiveTab}>
 *   <TabsList>
 *     <TabsTrigger value="active">Active</TabsTrigger>
 *     <TabsTrigger value="completed">Completed</TabsTrigger>
 *   </TabsList>
 * </Tabs>
 * ```
 */
export function useTabState(
  paramName: string = "tab",
  defaultValue: string
): [string, (value: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const isInitialized = useRef(false);

  // Read initial value from URL on mount
  const getUrlTab = useCallback(() => {
    if (typeof window === "undefined") return defaultValue;
    const params = new URLSearchParams(window.location.search);
    return params.get(paramName) || defaultValue;
  }, [paramName, defaultValue]);

  const [currentTab, setCurrentTab] = useState(getUrlTab);

  // Sync with URL on mount and popstate (browser back/forward)
  useEffect(() => {
    // Set initial value from URL
    if (!isInitialized.current) {
      const urlTab = getUrlTab();
      setCurrentTab(urlTab);
      isInitialized.current = true;
    }

    // Handle browser back/forward
    const handlePopState = () => {
      const urlTab = getUrlTab();
      setCurrentTab(urlTab);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [getUrlTab]);

  // Function to update the tab in the URL
  const setTab = useCallback(
    (value: string) => {
      // Update local state immediately for responsive UI
      setCurrentTab(value);

      // Build new URL
      const params = new URLSearchParams(window.location.search);

      // If the value is the default, remove the parameter to keep URLs clean
      if (value === defaultValue) {
        params.delete(paramName);
      } else {
        params.set(paramName, value);
      }

      // Build the new URL
      const queryString = params.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;

      // Update the URL without reloading the page
      router.push(newUrl, { scroll: false });
    },
    [router, pathname, paramName, defaultValue]
  );

  return [currentTab, setTab];
}
