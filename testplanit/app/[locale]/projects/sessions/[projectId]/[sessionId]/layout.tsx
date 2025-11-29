import type { Metadata } from "next";
import { fetchPageMetadata } from "~/lib/metadata";

type Props = {
  params: Promise<{ sessionId: string }>;
  children: React.ReactNode;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sessionId } = await params;
  return fetchPageMetadata("session", sessionId);
}

export default function SessionLayout({ children }: Props) {
  return <>{children}</>;
}
