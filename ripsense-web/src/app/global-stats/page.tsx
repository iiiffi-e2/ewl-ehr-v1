import { unstable_cache } from "next/cache";

import { GlobalStatsChart } from "@/components/charts/global-stats-chart";
import { SetHeatMap } from "@/components/charts/set-heatmap";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { globalSetStats } from "@/lib/mock-data";

const getCachedGlobalStats = unstable_cache(
  async () => {
    // Placeholder for Supabase aggregated query.
    return globalSetStats;
  },
  ["ripsense-global-stats"],
  { revalidate: 60 },
);

export default async function GlobalStatsPage() {
  const stats = await getCachedGlobalStats();

  const bySet = Object.values(
    stats.reduce<Record<string, { setName: string; packsLogged: number }>>((acc, row) => {
      if (!acc[row.setName]) {
        acc[row.setName] = { setName: row.setName, packsLogged: 0 };
      }
      acc[row.setName].packsLogged += row.packsLogged;
      return acc;
    }, {}),
  );

  const chartData = bySet.map((setRow) => ({
    setName: setRow.setName,
    packsLoggedM: Number((setRow.packsLogged / 1_000_000).toFixed(2)),
  }));

  const topSet = bySet.sort((a, b) => b.packsLogged - a.packsLogged)[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Global Pull Analytics</h1>
        <p className="mt-2 text-white/65">
          Aggregated, anonymized stats from collectors across sets and product formats.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total Packs Logged</CardDescription>
            <CardTitle className="metric-value text-3xl">
              {stats.reduce((sum, stat) => sum + stat.packsLogged, 0).toLocaleString()}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Most Active Set</CardDescription>
            <CardTitle className="text-2xl">{topSet?.setName}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Data Freshness</CardDescription>
            <CardTitle className="text-2xl">Realtime + 60s cache</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Packs Logged by Set</CardTitle>
          <CardDescription>Network-level activity across tracked Pokemon TCG expansions.</CardDescription>
        </CardHeader>
        <CardContent>
          <GlobalStatsChart data={chartData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Set Heat Map</CardTitle>
          <CardDescription>Which product formats are producing better hit density.</CardDescription>
        </CardHeader>
        <CardContent>
          <SetHeatMap
            data={stats.map((row) => ({
              setName: row.setName,
              productType: row.productType,
              avgPacksPerHit: row.avgHitRatePacks,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Global Stats Table</CardTitle>
          <CardDescription>Pull-rate benchmark data used by RipSense recommendations.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Set</TableHead>
                <TableHead>Product Type</TableHead>
                <TableHead className="text-right">Packs Logged</TableHead>
                <TableHead className="text-right">Avg Hit Rate</TableHead>
                <TableHead className="text-right">Chase Odds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.map((row) => (
                <TableRow key={`${row.setName}-${row.productType}`}>
                  <TableCell>{row.setName}</TableCell>
                  <TableCell>{row.productType}</TableCell>
                  <TableCell className="text-right">{row.packsLogged.toLocaleString()}</TableCell>
                  <TableCell className="text-right">1 in {row.avgHitRatePacks.toFixed(1)}</TableCell>
                  <TableCell className="text-right">1 in {row.chaseOddsPacks.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
