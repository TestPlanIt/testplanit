import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tags",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
