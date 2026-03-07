import { ArrowUpRight, Box, Sparkles, Trophy } from "lucide-react";

import { HitRateChart } from "@/components/charts/hit-rate-chart";
import { ValueOverTimeChart } from "@/components/charts/value-over-time-chart";
import { AiInsightCard } from "@/components/dashboard/ai-insight-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { boxIntelligenceFor, rarityDistribution, summarizeUserPerformance, valueSeries } from "@/lib/analytics";
import { demoUser, samplePacks } from "@/lib/mock-data";

export default function DashboardPage() {
  const trendData = valueSeries(samplePacks);
  const rarityData = rarityDistribution(samplePacks);
  const summary = summarizeUserPerformance(demoUser.username);
  const boxIntel = boxIntelligenceFor();
  const recentPulls = samplePacks.slice(0, 6).flatMap((pack) => pack.pulls).slice(0, 6);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarImage src={demoUser.avatarUrl} alt={demoUser.username} />
              <AvatarFallback>{demoUser.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm text-white/60">{summary.title}</p>
              <h1 className="text-2xl font-semibold text-white md:text-3xl">Welcome back, {demoUser.username}</h1>
              <p className="text-sm text-white/70">Best pull: {demoUser.bestPull}</p>
            </div>
          </div>
          <Badge variant="gold" className="w-fit">
            Luck rating: {summary.luckPercentile}th percentile
          </Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Packs Opened" value={demoUser.packsOpened.toLocaleString()} sub="+42 this month" />
        <StatCard label="Total Pull Value" value={`$${summary.totalValue.toLocaleString()}`} sub="Value over expected +12.4%" />
        <StatCard label="Hit Rate" value={`${summary.hitRate}%`} sub="1 hit every 4.1 packs" />
        <StatCard label="Trend" value={summary.trendDirection === "up" ? "Rising" : "Stable"} sub={summary.narrative} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Value Over Time</CardTitle>
            <CardDescription>Track pack value and cumulative pull returns.</CardDescription>
          </CardHeader>
          <CardContent>
            <ValueOverTimeChart data={trendData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Luck Percentile Meter</CardTitle>
            <CardDescription>Distribution-adjusted rarity and value score.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="metric-value text-4xl font-bold">{summary.luckPercentile}%</p>
            <p className="mt-2 text-sm text-white/70">You are outperforming 78% of tracked collectors for similar products.</p>
            <Progress value={summary.luckPercentile} className="mt-4" />
            <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="mb-1 text-sm text-white/70">Box intelligence</p>
              <p className="text-lg font-semibold text-white">{boxIntel.recommendation}</p>
              <p className="mt-1 text-xs text-white/65">
                Expected hits: {boxIntel.expectedHitsByNow} · Actual hits: {boxIntel.actualHits}
              </p>
              <p className="mt-2 text-xs text-[#ffcf57]">
                Probability this box rebounds: {Math.round((1 - boxIntel.probabilityAboveExpected) * 100)}%
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Hit Rate by Rarity</CardTitle>
            <CardDescription>Pull composition from your tracked sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <HitRateChart data={rarityData} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent Pulls Feed</CardTitle>
            <CardDescription>Latest cards logged from your recent packs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentPulls.map((pull) => (
              <div key={pull.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-white/10 p-2">
                    <Sparkles className="h-4 w-4 text-[--accent-blue]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{pull.cardName}</p>
                    <p className="text-xs text-white/60">
                      {pull.rarity} · {pull.setName}
                    </p>
                  </div>
                </div>
                <p className="text-sm font-semibold text-[#ffcf57]">${pull.marketValue.toFixed(2)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <AiInsightCard />
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  const iconMap = {
    "Packs Opened": Box,
    "Total Pull Value": Trophy,
    "Hit Rate": ArrowUpRight,
    Trend: Sparkles,
  } as const;

  const Icon = iconMap[label as keyof typeof iconMap] ?? Sparkles;

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-white/60">{label}</p>
          <Icon className="h-4 w-4 text-[--accent-blue]" />
        </div>
        <p className="metric-value text-2xl font-bold md:text-3xl">{value}</p>
        <p className="mt-1 text-xs text-white/60">{sub}</p>
      </CardContent>
    </Card>
  );
}
