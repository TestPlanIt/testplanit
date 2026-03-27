import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI Models",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
