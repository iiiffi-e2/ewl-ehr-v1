"use client";

import { useMemo, useState, useTransition } from "react";
import { Camera, Loader2, PlusCircle, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type DetectedCard = {
  cardName: string;
  rarity: string;
  marketValue: number;
  confidenceScore: number;
  setName: string;
  imageUrl: string;
};

const productTypes = ["Booster Box", "Elite Trainer Box", "Sleeved Booster", "Collection Box"];

export function PackLogForm() {
  const [isPending, startTransition] = useTransition();
  const [detectedCards, setDetectedCards] = useState<DetectedCard[]>([]);
  const [scanStatus, setScanStatus] = useState<string>("");
  const [packValue, setPackValue] = useState<number>(0);

  const totalDetectedValue = useMemo(
    () => detectedCards.reduce((sum, card) => sum + card.marketValue, 0),
    [detectedCards],
  );

  const onImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const form = new FormData();
    form.append("image", file);

    startTransition(async () => {
      setScanStatus("Scanning image with AI vision...");
      const response = await fetch("/api/ai/detect", {
        method: "POST",
        body: form,
      });
      const data = (await response.json()) as { detected: DetectedCard[]; status: string };
      setDetectedCards(data.detected);
      setPackValue(data.detected.reduce((sum, card) => sum + card.marketValue, 0));
      setScanStatus(data.status);
    });
  };

  return (
    <Tabs defaultValue="manual">
      <TabsList>
        <TabsTrigger value="manual">Manual Entry</TabsTrigger>
        <TabsTrigger value="ai">AI Pull Recognition</TabsTrigger>
      </TabsList>

      <TabsContent value="manual">
        <Card>
          <CardContent className="grid gap-4 p-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="setName">Set name</Label>
              <Input id="setName" placeholder="Paradox Rift" />
            </div>
            <div className="space-y-2">
              <Label>Product type</Label>
              <Select defaultValue="Booster Box">
                <SelectTrigger>
                  <SelectValue placeholder="Select product type" />
                </SelectTrigger>
                <SelectContent>
                  {productTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="packNumber">Pack number</Label>
              <Input id="packNumber" type="number" min={1} placeholder="12" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="boxId">Box ID (optional)</Label>
              <Input id="boxId" placeholder="box_paradox_01" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">Pull notes</Label>
              <Textarea id="notes" placeholder="ex: Pulled Iron Valiant ex + reverse holo." />
            </div>
            <div className="md:col-span-2">
              <Button className="w-full">
                <PlusCircle className="mr-2 h-4 w-4" />
                Save Pack Log
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="ai">
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="rounded-xl border border-dashed border-white/20 bg-white/[0.03] p-5">
              <Label htmlFor="image" className="mb-2 block">
                Upload cards image
              </Label>
              <Input id="image" type="file" accept="image/*" onChange={onImageUpload} className="cursor-pointer" />
              <p className="mt-2 text-xs text-white/55">
                Tip: fan cards on a neutral background for best detection confidence.
              </p>
            </div>

            {isPending && (
              <div className="flex items-center gap-2 text-sm text-white/70">
                <Loader2 className="h-4 w-4 animate-spin" />
                {scanStatus || "Analyzing image..."}
              </div>
            )}

            {!isPending && scanStatus && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/80">{scanStatus}</div>
            )}

            {detectedCards.length > 0 && (
              <div className="space-y-3">
                {detectedCards.map((card, idx) => (
                  <div
                    key={`${card.cardName}-${idx}`}
                    className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-[--accent-purple]/25 p-2">
                        <Camera className="h-4 w-4 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{card.cardName}</p>
                        <p className="text-xs text-white/60">
                          {card.rarity} · {card.setName}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{Math.round(card.confidenceScore * 100)}% confidence</Badge>
                      <Badge variant="gold">${card.marketValue.toFixed(2)}</Badge>
                    </div>
                  </div>
                ))}
                <div className="rounded-xl border border-[--accent-blue]/30 bg-[--accent-blue]/10 p-4">
                  <p className="text-sm text-white/70">Estimated pack value</p>
                  <p className="metric-value mt-1 text-3xl font-bold">${(packValue || totalDetectedValue).toFixed(2)}</p>
                  <div className="mt-3 flex gap-2">
                    <Button className="flex-1">
                      <Sparkles className="mr-2 h-4 w-4" />
                      Confirm Detected Pulls
                    </Button>
                    <Button className="flex-1" variant="secondary">
                      Edit Detection
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
