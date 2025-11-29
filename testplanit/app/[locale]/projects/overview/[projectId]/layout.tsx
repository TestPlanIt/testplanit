import type { Metadata } from "next";
import { fetchPageMetadata } from "~/lib/metadata";

type Props = {
  params: Promise<{ projectId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params;
  return fetchPageMetadata("project", projectId);
}

export default function ProjectOverviewLayout({ children }: Props) {
  return <>{children}</>;
}
