"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ReactNode } from "react";

type ThemeProviderProps = {
  children: ReactNode;
  attribute?: string;
  defaultTheme?: string;
  enableSystem?: boolean;
  themes?: string[];
  storageKey?: string;
  disableTransitionOnChange?: boolean;
  /** CSP nonce for the inline script that applies the theme before paint. */
  nonce?: string;
};

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      themes={[
        "light",
        "dark",
        "green",
        "orange",
        "purple",
        "accessible",
        "accessibledark",
      ]}
      defaultTheme="system"
      attribute="class"
      {...(props as any)}
    >
      {children}
    </NextThemesProvider>
  );
}
