import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shares",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
