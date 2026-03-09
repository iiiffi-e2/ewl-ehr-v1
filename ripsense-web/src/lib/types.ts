export type ProductType =
  | "Booster Box"
  | "Elite Trainer Box"
  | "Sleeved Booster"
  | "Collection Box";

export type PullRarity =
  | "Common"
  | "Uncommon"
  | "Rare"
  | "Reverse Holo"
  | "Holo Rare"
  | "ex"
  | "Illustration Rare"
  | "Special Illustration Rare"
  | "Secret Rare"
  | "Hyper Rare";

export type Pull = {
  id: string;
  packId: string;
  cardId: string;
  cardName: string;
  setName: string;
  rarity: PullRarity;
  marketValue: number;
  imageUrl: string;
  confidenceScore: number;
  openedAt: string;
};

export type Pack = {
  id: string;
  userId: string;
  setName: string;
  productType: ProductType;
  packNumber: number;
  boxId?: string;
  openedAt: string;
  imageUrl?: string;
  pulls: Pull[];
};

export type UserStats = {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
  packsOpened: number;
  totalPullValue: number;
  luckPercentile: number;
  bestPull: string;
  createdAt: string;
};

export type BoxIntelligence = {
  setName: string;
  productType: ProductType;
  packsOpened: number;
  expectedHitsByNow: number;
  actualHits: number;
  recommendation: "Keep opening" | "Stop opening";
  confidence: number;
};

export type GlobalSetStat = {
  setName: string;
  productType: ProductType;
  packsLogged: number;
  avgHitRatePacks: number;
  chaseOddsPacks: number;
  updatedAt: string;
};
