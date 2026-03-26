import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Link SSO Account",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
