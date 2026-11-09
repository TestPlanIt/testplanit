import { NextResponse } from "next/server";

/**
 * API endpoint to return trial configuration at runtime.
 * This is needed because NEXT_PUBLIC_* variables are replaced at build time,
 * but trial instances need to read these values from environment at runtime.
 */
export async function GET() {
  const isTrialInstance = process.env.IS_TRIAL_INSTANCE === "true";
  const trialEndDate = process.env.TRIAL_END_DATE || null;
  // Set by the control plane for non-payment / ended subscription; proxy.ts
  // already redirects every page to /trial-expired?reason=suspended.
  const isSuspended = process.env.INSTANCE_SUSPENDED === "true";
  const websiteUrl =
    process.env.NEXT_PUBLIC_WEBSITE_URL || "https://testplanit.com";
  const contactEmail =
    process.env.NEXT_PUBLIC_CONTACT_EMAIL || "sales@testplanit.com";
  const feedbackSurveyUrl = process.env.FEEDBACK_SURVEY_URL || null;

  return NextResponse.json({
    isTrialInstance,
    isSuspended,
    trialEndDate,
    websiteUrl,
    contactEmail,
    feedbackSurveyUrl,
  });
}
