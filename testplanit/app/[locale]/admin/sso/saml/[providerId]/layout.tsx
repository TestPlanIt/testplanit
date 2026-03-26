import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin - SAML Configuration",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
