"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "~/components/theme-provider";
import { useState, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { SearchStateProvider } from "~/lib/contexts/SearchStateContext";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnMount: true,
      refetchOnReconnect: true,
      staleTime: 10000,
      gcTime: 5 * 60 * 1000, // 5 minutes
    },
  },
});

export default function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);


  const content = mounted ? (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={["light", "dark", "system", "green", "orange", "purple"]}
    >
      <SearchStateProvider>{children}</SearchStateProvider>
    </ThemeProvider>
  ) : (
    <SearchStateProvider>{children}</SearchStateProvider>
  );


  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        {content}
      </SessionProvider>
    </QueryClientProvider>
  );
}
