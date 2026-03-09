"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Dice5, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const sets = ["Paradox Rift", "Crown Zenith", "Obsidian Flames"];
const products = ["Booster Box", "Elite Trainer Box", "Sleeved Booster"];

type SimResult = {
  ex: number;
  hyperRare: number;
  secretRare: number;
  illustrationRare: number;
};

export default function SimulatorPage() {
  const [selectedSet, setSelectedSet] = useState("Paradox Rift");
  const [selectedProduct, setSelectedProduct] = useState("Booster Box");
  const [result, setResult] = useState<SimResult | null>(null);

  const packCount = selectedProduct === "Booster Box" ? 36 : selectedProduct === "Elite Trainer Box" ? 9 : 12;

  const totalHits = useMemo(() => {
    if (!result) return 0;
    return result.ex + result.hyperRare + result.secretRare + result.illustrationRare;
  }, [result]);

  const runSimulation = () => {
    const rolls = Array.from({ length: packCount }).map(() => Math.random());
    const next: SimResult = { ex: 0, hyperRare: 0, secretRare: 0, illustrationRare: 0 };

    rolls.forEach((roll) => {
      if (roll > 0.78) next.ex += 1;
      if (roll > 0.93) next.illustrationRare += 1;
      if (roll > 0.975) next.secretRare += 1;
      if (roll > 0.99) next.hyperRare += 1;
    });

    setResult(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Pack Simulator</h1>
        <p className="mt-2 text-white/65">Open a virtual product and see statistically modeled hit outcomes.</p>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-6 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm text-white/70">Set</p>
            <Select value={selectedSet} onValueChange={setSelectedSet}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sets.map((setName) => (
                  <SelectItem key={setName} value={setName}>
                    {setName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-sm text-white/70">Product type</p>
            <Select value={selectedProduct} onValueChange={setSelectedProduct}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product} value={product}>
                    {product}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button onClick={runSimulation} className="w-full">
              <Dice5 className="mr-2 h-4 w-4" />
              Simulate {packCount} Packs
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Simulation Results</CardTitle>
            <CardDescription>
              You opened {packCount} packs of {selectedSet} ({selectedProduct}).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "ex", value: result.ex, color: "bg-[#00c2ff]/15 border-[#00c2ff]/30" },
                { label: "Illustration Rare", value: result.illustrationRare, color: "bg-[#7b61ff]/15 border-[#7b61ff]/30" },
                { label: "Secret Rare", value: result.secretRare, color: "bg-[#ffcf57]/15 border-[#ffcf57]/30" },
                { label: "Hyper Rare", value: result.hyperRare, color: "bg-[#ff6b8a]/15 border-[#ff6b8a]/30" },
              ].map((item) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-xl border p-4 ${item.color}`}
                >
                  <p className="text-sm text-white/70">{item.label}</p>
                  <p className="mt-1 text-3xl font-bold">{item.value}</p>
                </motion.div>
              ))}
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm text-white/70">Outcome summary</p>
              <p className="mt-1 text-lg font-semibold">
                Total hits: {totalHits} across {packCount} packs
              </p>
              <Badge variant="gold" className="mt-3">
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                Animated card reveals placeholder
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
