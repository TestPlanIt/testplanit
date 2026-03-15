"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ThemeProvider } from "~/components/theme-provider";
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
      themes={["light", "dark", "green", "orange", "purple"]}
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
