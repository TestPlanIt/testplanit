import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "~/server/auth";
import { ShareLayoutContent } from "./ShareLayoutContent";

export const metadata: Metadata = {
  title: "Shared Content | TestPlanIt",
  description: "View shared content from TestPlanIt",
};

/**
 * Minimal layout for public share pages
 * No header, no navigation - just the shared content
 */
export default async function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);

  return <ShareLayoutContent session={session}>{children}</ShareLayoutContent>;
}
