import type { Metadata } from "next";
import { fetchPageMetadata } from "~/lib/metadata";

type Props = {
  params: Promise<{ caseId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { caseId } = await params;
  return fetchPageMetadata("test-case", caseId);
}

export default function TestCaseLayout({ children }: Props) {
  return <>{children}</>;
}
