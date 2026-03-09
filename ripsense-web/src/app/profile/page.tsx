import Link from "next/link";
import { Share2, Trophy } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { demoUser, samplePacks } from "@/lib/mock-data";

export default function ProfilePage() {
  const recentHits = samplePacks
    .flatMap((pack) => pack.pulls)
    .filter((pull) => pull.marketValue > 3)
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={demoUser.avatarUrl} alt={demoUser.username} />
              <AvatarFallback>{demoUser.username.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-2xl font-semibold">{demoUser.username}</h1>
              <p className="text-sm text-white/65">{demoUser.email}</p>
              <p className="mt-1 text-sm text-white/70">Collector since {new Date(demoUser.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          <Badge variant="gold">Luck score: {demoUser.luckPercentile}th percentile</Badge>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Packs opened</CardDescription>
            <CardTitle className="metric-value text-3xl">{demoUser.packsOpened}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Best pull</CardDescription>
            <CardTitle className="text-xl">{demoUser.bestPull}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total pull value</CardDescription>
            <CardTitle className="metric-value text-3xl">${demoUser.totalPullValue.toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Pulls Gallery</CardTitle>
          <CardDescription>Share your biggest hits with one click.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {recentHits.map((hit) => (
            <div key={hit.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="mb-3 h-28 rounded-lg bg-[linear-gradient(135deg,rgba(123,97,255,0.3),rgba(0,194,255,0.25))]" />
              <p className="truncate text-sm font-semibold">{hit.cardName}</p>
              <p className="text-xs text-white/60">{hit.rarity}</p>
              <p className="mt-2 text-sm text-[#ffcf57]">${hit.marketValue.toFixed(2)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold">Pulled Iron Valiant ex · Pack #1</p>
            <p className="text-sm text-white/65">Luck rating: 99.4% · Generate a shareable image card</p>
          </div>
          <Button asChild>
            <Link href="/share/iron-valiant-ex">
              <Share2 className="mr-2 h-4 w-4" />
              Open Share Card
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Advanced Features</CardTitle>
          <CardDescription>Future modules ready for expansion.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {["Live RipCam", "Sealed product batch analysis", "Marketplace integrations"].map((feature) => (
            <div key={feature} className="rounded-xl border border-dashed border-white/20 bg-white/[0.03] p-4">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Trophy className="h-4 w-4 text-[--accent-blue]" />
                {feature}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
