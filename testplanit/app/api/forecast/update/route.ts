import { NextRequest, NextResponse } from "next/server";
import { updateRepositoryCaseForecast } from "~/services/forecastService";

export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (!caseId || isNaN(Number(caseId))) {
    return NextResponse.json(
      { error: "Missing or invalid caseId" },
      { status: 400 }
    );
  }

  try {
    await updateRepositoryCaseForecast(Number(caseId));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forecast update error:", error);
    return NextResponse.json(
      { error: "Failed to update forecast" },
      { status: 500 }
    );
  }
}
