"use client";

import { ForecastDisplay } from "@/components/ForecastDisplay";
import { useQuery } from "@tanstack/react-query";

interface MilestoneForecastData {
  manualEstimate: number;
  mixedEstimate: number;
  automatedEstimate: number;
  areAllCasesAutomated: boolean;
}

interface MilestoneForecastChipsProps {
  milestoneId: number;
}

/**
 * Remaining-effort forecast for a milestone's in-scope cases, as one or two
 * inline chips. Self-fetching like {@link MilestoneSummary} beside it, and
 * cached per milestone id so a list of rows costs one request each and
 * re-renders free. Renders nothing until the estimate arrives, and nothing at
 * all when there is no effort left to forecast — an empty chip slot reads
 * better than a spinner in a row that is mostly other content.
 *
 * A fully automated milestone shows only the automated estimate; otherwise
 * manual and automated show side by side, each only when non-zero.
 */
export function MilestoneForecastChips({
  milestoneId,
}: MilestoneForecastChipsProps) {
  const { data } = useQuery<MilestoneForecastData>({
    queryKey: ["milestoneForecast", milestoneId],
    queryFn: async () => {
      const response = await fetch(`/api/milestones/${milestoneId}/forecast`);
      if (!response.ok) {
        throw new Error(`Forecast request failed with ${response.status}`);
      }
      return response.json();
    },
    staleTime: 60000,
  });

  if (!data) return null;

  const { manualEstimate, automatedEstimate, areAllCasesAutomated } = data;
  const showManual = !areAllCasesAutomated && manualEstimate > 0;
  const showAutomated = automatedEstimate > 0;
  if (!showManual && !showAutomated) return null;

  return (
    <div className="flex min-w-0 items-center gap-x-1.5 text-muted-foreground">
      {showManual && (
        <ForecastDisplay
          seconds={manualEstimate}
          type="manual"
          className="text-xs"
        />
      )}
      {showAutomated && (
        <ForecastDisplay
          seconds={automatedEstimate}
          type="automated"
          className="text-xs"
        />
      )}
    </div>
  );
}
