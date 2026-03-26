import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shared Steps",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
