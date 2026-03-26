import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Duplicate Test Cases",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
