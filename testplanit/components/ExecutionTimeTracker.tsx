"use client";

import { TimeTracker } from "@/components/TimeTracker";
import { useExecutionTimer } from "~/hooks/useExecutionTimer";

/**
 * The running clock for one case in a test run. Mounting it starts timing the
 * case; unmounting it stops. Render it only where a result can be entered.
 */
export function ExecutionTimeTracker({ timerKey }: { timerKey: string }) {
  const timer = useExecutionTimer(timerKey);

  return (
    <TimeTracker
      size="sm"
      value={timer.seconds}
      running={timer.running}
      onRunningChange={(run) => (run ? timer.resume() : timer.pause())}
      onValueChange={timer.set}
    />
  );
}
