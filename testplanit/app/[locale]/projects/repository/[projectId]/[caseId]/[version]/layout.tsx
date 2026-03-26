import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Test Case Version",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
