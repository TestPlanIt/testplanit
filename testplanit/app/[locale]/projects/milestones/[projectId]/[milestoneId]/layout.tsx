import type { Metadata } from "next";
import { fetchPageMetadata } from "~/lib/metadata";

type Props = {
  params: Promise<{ milestoneId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { milestoneId } = await params;
  return fetchPageMetadata("milestone", milestoneId);
}

export default function MilestoneLayout({ children }: Props) {
  return <>{children}</>;
}
