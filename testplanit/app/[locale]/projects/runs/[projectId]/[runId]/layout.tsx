import type { Metadata } from "next";
import { fetchPageMetadata } from "~/lib/metadata";

type Props = {
  params: Promise<{ runId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { runId } = await params;
  return fetchPageMetadata("test-run", runId);
}

export default function TestRunLayout({ children }: Props) {
  return <>{children}</>;
}
