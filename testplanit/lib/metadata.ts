import type { Metadata } from "next";

type MetadataType =
  | "test-run"
  | "test-case"
  | "session"
  | "project"
  | "milestone";

interface MetadataResponse {
  title: string;
  description: string;
}

const DEFAULT_TITLE = "TestPlanIt";
const DEFAULT_DESCRIPTION =
  "Modern test management platform for test case management, execution tracking, and comprehensive reporting.";

/**
 * Fetches dynamic metadata from the API for Open Graph link previews.
 * Falls back to defaults if the fetch fails.
 */
export async function fetchPageMetadata(
  type: MetadataType,
  id: string
): Promise<Metadata> {
  const baseUrl = process.env.NEXTAUTH_URL || "https://app.testplanit.com";

  try {
    const response = await fetch(
      `${baseUrl}/api/metadata?type=${type}&id=${id}`,
      {
        next: { revalidate: 60 }, // Cache for 60 seconds
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch metadata");
    }

    const data: MetadataResponse = await response.json();
    const title = data.title
      ? `${data.title} | TestPlanIt`
      : `${DEFAULT_TITLE}`;
    const description = data.description || DEFAULT_DESCRIPTION;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "TestPlanIt",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    };
  }
}
