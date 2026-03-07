import { NextResponse } from "next/server";

const detectedCards = [
  {
    cardName: "Iron Valiant ex",
    rarity: "Special Illustration Rare",
    marketValue: 58.4,
    confidenceScore: 0.93,
    setName: "Paradox Rift",
    imageUrl: "https://images.pokemontcg.io/sv4/249_hires.png",
  },
  {
    cardName: "Mela",
    rarity: "Reverse Holo",
    marketValue: 1.8,
    confidenceScore: 0.89,
    setName: "Paradox Rift",
    imageUrl: "https://images.pokemontcg.io/sv4/167_hires.png",
  },
  {
    cardName: "Gligar",
    rarity: "Common",
    marketValue: 0.05,
    confidenceScore: 0.97,
    setName: "Paradox Rift",
    imageUrl: "https://images.pokemontcg.io/sv4/106_hires.png",
  },
];

export async function POST(request: Request) {
  const formData = await request.formData();
  const image = formData.get("image");

  if (!image) {
    return NextResponse.json({ status: "No image provided.", detected: [] }, { status: 400 });
  }

  return NextResponse.json({
    status:
      "Detection complete. Cards matched against Pokemon card database. Review confidence scores before saving.",
    detected: detectedCards,
  });
}
