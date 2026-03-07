import { boxSamples, getRarityWeight, globalSetStats, samplePacks } from "@/lib/mock-data";
import type { Pack, Pull } from "@/lib/types";

export function packValue(pack: Pack) {
  return pack.pulls.reduce((sum, pull) => sum + pull.marketValue, 0);
}

export function totalPullValue(packs: Pack[]) {
  return packs.reduce((sum, pack) => sum + packValue(pack), 0);
}

export function hitRate(packs: Pack[]) {
  if (packs.length === 0) {
    return 0;
  }
  const hits = packs.filter((pack) =>
    pack.pulls.some((pull) => getRarityWeight(pull.rarity) >= 2),
  ).length;
  return hits / packs.length;
}

export function estimateLuckPercentile(pulls: Pull[]) {
  if (pulls.length === 0) {
    return 50;
  }
  const weightedScore =
    pulls.reduce((sum, pull) => sum + getRarityWeight(pull.rarity) * Math.max(1, pull.marketValue), 0) /
    pulls.length;
  const normalized = Math.min(99.9, Math.max(1, weightedScore * 4.2));
  return Math.round(normalized * 10) / 10;
}

export function valueSeries(packs: Pack[]) {
  return [...packs]
    .sort((a, b) => +new Date(a.openedAt) - +new Date(b.openedAt))
    .reduce<Array<{ day: string; value: number; cumulative: number }>>((acc, pack) => {
      const value = packValue(pack);
      const cumulative = (acc.at(-1)?.cumulative ?? 0) + value;
      acc.push({
        day: new Date(pack.openedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: Number(value.toFixed(2)),
        cumulative: Number(cumulative.toFixed(2)),
      });
      return acc;
    }, []);
}

export function rarityDistribution(packs: Pack[]) {
  const map = new Map<string, number>();
  packs.flatMap((pack) => pack.pulls).forEach((pull) => {
    map.set(pull.rarity, (map.get(pull.rarity) ?? 0) + 1);
  });
  return [...map.entries()].map(([rarity, count]) => ({ rarity, count }));
}

export function boxIntelligenceFor(boxId = "box_paradox_01") {
  const packs = samplePacks.filter((pack) => pack.boxId === boxId);
  const logged = boxSamples.find((box) => box.setName === packs[0]?.setName) ?? boxSamples[0];
  const probabilityAboveExpected = logged.actualHits > logged.expectedHitsByNow ? 0.78 : 0.37;
  return {
    ...logged,
    probabilityAboveExpected,
  };
}

export function setHeatMapData() {
  return globalSetStats.map((item) => ({
    setName: item.setName,
    productType: item.productType,
    hitRate: Number((1 / item.avgHitRatePacks).toFixed(3)),
    avgPacksPerHit: item.avgHitRatePacks,
  }));
}

export function summarizeUserPerformance(username: string) {
  const packs = samplePacks;
  const pulls = packs.flatMap((pack) => pack.pulls);
  const luck = estimateLuckPercentile(pulls);
  const value = totalPullValue(packs);
  const hitrate = hitRate(packs);
  const trend = valueSeries(packs);
  const trendDirection = trend.length > 3 && trend.at(-1)!.value > trend.at(-4)!.value ? "up" : "stable";

  return {
    title: `${username}'s Trainer Stats`,
    packsOpened: packs.length,
    totalValue: Number(value.toFixed(2)),
    hitRate: Number((hitrate * 100).toFixed(1)),
    luckPercentile: luck,
    trendDirection,
    narrative:
      trendDirection === "up"
        ? "Your recent sessions show improving value density compared with your prior baseline."
        : "Your pull performance is stable and close to expected distribution for your tracked sets.",
  };
}
