import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tag Details",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
