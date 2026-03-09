"use client";

import { motion } from "framer-motion";
import { ArrowUpRight, Sparkles, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AnimatedMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
      className="relative mx-auto max-w-4xl"
    >
      <div className="absolute -inset-6 -z-10 rounded-3xl bg-[radial-gradient(circle,rgba(123,97,255,0.35),transparent_65%)] blur-3xl" />
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-white/10">
          <CardTitle className="flex items-center justify-between text-base">
            <span>RipSense Analytics Preview</span>
            <Badge variant="gold">
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              Live AI Pull Detection
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 p-6 md:grid-cols-3">
          <motion.div
            className="rounded-xl border border-white/10 bg-white/5 p-4"
            animate={{ y: [0, -3, 0] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 3.6 }}
          >
            <p className="text-xs text-white/60">Luck Percentile</p>
            <p className="metric-value mt-2 text-3xl font-bold">78.0%</p>
            <p className="mt-1 text-xs text-emerald-300">+6.4 pts this month</p>
          </motion.div>
          <motion.div
            className="rounded-xl border border-white/10 bg-white/5 p-4"
            animate={{ y: [0, -4, 0] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 4.2, delay: 0.3 }}
          >
            <p className="text-xs text-white/60">Total Pull Value</p>
            <p className="metric-value mt-2 text-3xl font-bold">$1,873</p>
            <p className="mt-1 flex items-center text-xs text-sky-300">
              <TrendingUp className="mr-1 h-3.5 w-3.5" />
              Value trend is accelerating
            </p>
          </motion.div>
          <motion.div
            className="rounded-xl border border-white/10 bg-white/5 p-4"
            animate={{ y: [0, -2, 0] }}
            transition={{ repeat: Number.POSITIVE_INFINITY, duration: 3.8, delay: 0.5 }}
          >
            <p className="text-xs text-white/60">Box Intelligence</p>
            <p className="mt-2 text-lg font-semibold text-white">Keep opening</p>
            <p className="mt-1 text-xs text-white/70">Expected hits: 2.8 • Actual: 1</p>
            <p className="mt-3 flex items-center text-xs text-[#ffcf57]">
              <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
              63% probability of rebound
            </p>
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
