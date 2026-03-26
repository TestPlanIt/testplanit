import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Two-Factor Verification",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
