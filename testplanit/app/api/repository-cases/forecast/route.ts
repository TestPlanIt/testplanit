import { NextResponse } from "next/server";
import { db } from "~/server/db";
import type { NextRequest } from "next/server";
import { z } from "zod/v4";

const RequestBodySchema = z.object({
  caseIds: z.array(z.int().positive()).min(1),
});

export async function POST(request: NextRequest) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = RequestBodySchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid request body", issues: validation.error.issues },
      { status: 400 }
    );
  }

  const { caseIds } = validation.data;

  try {
    const repositoryCases = await db.repositoryCases.findMany({
      where: {
        id: { in: caseIds },
        isDeleted: false,
        isArchived: false,
      },
      select: {
        id: true,
        estimate: true,
        forecastManual: true,
        forecastAutomated: true,
        source: true,
      },
    });

    if (!repositoryCases || repositoryCases.length === 0) {
      return NextResponse.json({
        manualEstimate: 0,
        mixedEstimate: 0,
        automatedEstimate: 0,
        areAllCasesAutomated: false,
        fetchedTestCasesCount: 0,
      });
    }

    let totalManual = 0;
    let totalMixed = 0;
    let totalAutomated = 0;
    let allAutomatedCheck = true;

    repositoryCases.forEach((tc) => {
      const manualForecastVal = tc.forecastManual ?? tc.estimate ?? 0;
      const automatedForecastVal = tc.forecastAutomated ?? 0;

      totalManual += manualForecastVal;

      if (automatedForecastVal > 0) {
        totalMixed += automatedForecastVal;
        totalAutomated += automatedForecastVal;
        // A case is only considered fully automated if it has a positive automated forecast.
        // If tc.forecastAutomated is null or 0, it's not automated for this check.
        if (!(tc.forecastAutomated && tc.forecastAutomated > 0)) {
          allAutomatedCheck = false;
        }
      } else {
        totalMixed += manualForecastVal;
        allAutomatedCheck = false;
      }
    });

    // Refined allAutomatedCheck logic to exactly match the modal's intent
    // The modal's logic: areAllCasesAutomated: allAutomatedCheckFromLoop && fetchedTestCases.length > 0
    // The loop for allAutomatedCheck in the modal was implicitly: if any case is not automated, it becomes false.
    // A case is automated if (tc.forecastAutomated && tc.forecastAutomated > 0)
    // So, if even one case doesn't meet this, the whole set is not 'allAutomated'.

    if (repositoryCases.length > 0) {
      allAutomatedCheck = repositoryCases.every(
        (tc) => tc.forecastAutomated && tc.forecastAutomated > 0
      );
    } else {
      allAutomatedCheck = false;
    }

    return NextResponse.json({
      manualEstimate: totalManual,
      mixedEstimate: totalMixed,
      automatedEstimate: totalAutomated,
      areAllCasesAutomated: allAutomatedCheck,
      fetchedTestCasesCount: repositoryCases.length,
    });
  } catch (error) {
    console.error("Failed to calculate repository cases forecast:", error);
    return NextResponse.json(
      { error: "Internal server error while calculating forecast." },
      { status: 500 }
    );
  }
}
