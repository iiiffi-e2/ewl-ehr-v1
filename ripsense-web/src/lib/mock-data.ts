import type { BoxIntelligence, GlobalSetStat, Pack, ProductType, UserStats } from "@/lib/types";

export const demoUser: UserStats = {
  id: "user_eric",
  username: "Eric",
  email: "eric@ripsense.app",
  avatarUrl:
    "https://images.unsplash.com/photo-1552058544-f2b08422138a?auto=format&fit=crop&w=200&q=80",
  packsOpened: 1204,
  totalPullValue: 1873.22,
  luckPercentile: 78,
  bestPull: "Umbreon VMAX Alt Art",
  createdAt: "2025-02-12T10:31:00.000Z",
};

const rarityWeights: Record<string, number> = {
  Common: 0.2,
  Uncommon: 0.4,
  Rare: 0.8,
  "Reverse Holo": 1.1,
  "Holo Rare": 1.4,
  ex: 2.3,
  "Illustration Rare": 3.4,
  "Special Illustration Rare": 4.8,
  "Secret Rare": 5.4,
  "Hyper Rare": 6.8,
};

const now = Date.now();

export const samplePacks: Pack[] = Array.from({ length: 18 }).map((_, index) => {
  const packId = `pack_${index + 1}`;
  const setName = index % 2 === 0 ? "Paradox Rift" : "Crown Zenith";
  const productType: ProductType =
    index % 3 === 0 ? "Booster Box" : index % 3 === 1 ? "Elite Trainer Box" : "Sleeved Booster";
  const openedAt = new Date(now - index * 1000 * 60 * 60 * 24 * 3).toISOString();
  const hit = index % 4 === 0;

  const pulls: Pack["pulls"] = hit
    ? [
        {
          id: `pull_${packId}_1`,
          packId,
          cardId: `sv4-${100 + index}`,
          cardName: index % 8 === 0 ? "Iron Valiant ex" : "Roaring Moon ex",
          setName,
          rarity: index % 8 === 0 ? "Special Illustration Rare" : "ex",
          marketValue: index % 8 === 0 ? 58 + index : 8 + index * 0.4,
          imageUrl:
            "https://images.pokemontcg.io/sv4/249_hires.png",
          confidenceScore: 0.92,
          openedAt,
        },
      ]
    : [
        {
          id: `pull_${packId}_1`,
          packId,
          cardId: `sv4-${20 + index}`,
          cardName: "Gligar",
          setName,
          rarity: "Common",
          marketValue: 0.05,
          imageUrl:
            "https://images.pokemontcg.io/sv4/106_hires.png",
          confidenceScore: 0.97,
          openedAt,
        },
      ];

  return {
    id: packId,
    userId: demoUser.id,
    setName,
    productType,
    packNumber: index + 1,
    boxId: index < 12 ? "box_paradox_01" : undefined,
    openedAt,
    imageUrl:
      "https://images.unsplash.com/photo-1627856013091-fed6e4e30025?auto=format&fit=crop&w=900&q=80",
    pulls,
  };
});

export const globalSetStats: GlobalSetStat[] = [
  {
    setName: "Crown Zenith",
    productType: "Booster Box",
    packsLogged: 1284112,
    avgHitRatePacks: 4.3,
    chaseOddsPacks: 284,
    updatedAt: new Date().toISOString(),
  },
  {
    setName: "Obsidian Flames",
    productType: "Booster Box",
    packsLogged: 684902,
    avgHitRatePacks: 4.2,
    chaseOddsPacks: 311,
    updatedAt: new Date().toISOString(),
  },
  {
    setName: "Obsidian Flames",
    productType: "Elite Trainer Box",
    packsLogged: 312101,
    avgHitRatePacks: 6.9,
    chaseOddsPacks: 448,
    updatedAt: new Date().toISOString(),
  },
  {
    setName: "Obsidian Flames",
    productType: "Sleeved Booster",
    packsLogged: 410447,
    avgHitRatePacks: 5.7,
    chaseOddsPacks: 397,
    updatedAt: new Date().toISOString(),
  },
  {
    setName: "Paradox Rift",
    productType: "Booster Box",
    packsLogged: 531982,
    avgHitRatePacks: 4.8,
    chaseOddsPacks: 364,
    updatedAt: new Date().toISOString(),
  },
];

export const boxSamples: BoxIntelligence[] = [
  {
    setName: "Paradox Rift",
    productType: "Booster Box",
    packsOpened: 12,
    expectedHitsByNow: 2.8,
    actualHits: 1,
    recommendation: "Keep opening",
    confidence: 0.81,
  },
  {
    setName: "Crown Zenith",
    productType: "Elite Trainer Box",
    packsOpened: 8,
    expectedHitsByNow: 1.2,
    actualHits: 3,
    recommendation: "Stop opening",
    confidence: 0.74,
  },
];

export function getRarityWeight(rarity: string) {
  return rarityWeights[rarity] ?? 1;
}
