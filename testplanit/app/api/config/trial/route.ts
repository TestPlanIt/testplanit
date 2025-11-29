import { NextResponse } from "next/server";

/**
 * API endpoint to return trial configuration at runtime.
 * This is needed because NEXT_PUBLIC_* variables are replaced at build time,
 * but trial instances need to read these values from environment at runtime.
 */
export async function GET() {
  const isTrialInstance = process.env.IS_TRIAL_INSTANCE === "true";
  const trialEndDate = process.env.TRIAL_END_DATE || null;
  const websiteUrl = process.env.NEXT_PUBLIC_WEBSITE_URL || "https://testplanit.com";
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "sales@testplanit.com";

  return NextResponse.json({
    isTrialInstance,
    trialEndDate,
    websiteUrl,
    contactEmail,
  });
}
