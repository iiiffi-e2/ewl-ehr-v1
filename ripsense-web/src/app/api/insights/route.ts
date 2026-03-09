import { NextResponse } from "next/server";

import { summarizeUserPerformance } from "@/lib/analytics";
import { demoUser } from "@/lib/mock-data";

export async function GET() {
  const summary = summarizeUserPerformance(demoUser.username);
  return NextResponse.json({
    source: "llm-placeholder",
    summary: `Luck rating is ${summary.luckPercentile}th percentile with ${summary.hitRate}% hit rate. ${summary.narrative}`,
    metrics: summary,
  });
}
