import Link from "next/link";
import { Activity, Brain, Camera, Flame, Sparkles, Target } from "lucide-react";

import { AnimatedMockup } from "@/components/landing/animated-mockup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const featureHighlights = [
  {
    icon: Brain,
    title: "AI Pull Recognition",
    description: "Upload a pack photo and auto-detect cards, rarity, confidence, and market value.",
  },
  {
    icon: Activity,
    title: "Luck Analytics",
    description: "Track percentile ranking against expected pull distribution and global user trends.",
  },
  {
    icon: Target,
    title: "Box Intelligence",
    description: "See whether your box is statistically hot or cold before opening your next pack.",
  },
  {
    icon: Flame,
    title: "Set Heat Maps",
    description: "Compare hit efficiency across Booster Boxes, ETBs, sleeved packs, and more.",
  },
];

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 md:px-6">
      <header className="flex items-center justify-between py-6">
        <div>
          <p className="text-lg font-semibold">RipSense</p>
          <p className="text-xs text-white/55">AI Pull Analytics Platform</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/auth">Sign in</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard">Open App</Link>
          </Button>
        </div>
      </header>

      <section className="pt-10 pb-16 text-center md:pt-18">
        <Badge variant="secondary" className="mb-5">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          AI-powered analytics for trading card collectors
        </Badge>
        <h1 className="mx-auto max-w-4xl text-4xl font-bold tracking-tight text-white md:text-6xl">
          Stop guessing. Start analyzing your pulls.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-white/70 md:text-xl">
          RipSense helps collectors log packs, detect pulls with AI vision, and turn openings into actionable
          performance analytics.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/log-pack">Start Logging Packs</Link>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/global-stats">View Global Stats</Link>
          </Button>
        </div>
      </section>

      <section className="pb-16">
        <AnimatedMockup />
      </section>

      <section className="pb-16">
        <div className="mb-6 text-center">
          <h2 className="text-3xl font-semibold text-white md:text-4xl">How it works</h2>
          <p className="mt-2 text-white/60">From pack rip to predictive intelligence in seconds.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { title: "1. Log your pack", icon: Camera, body: "Capture your pull session with manual entry or photo upload." },
            { title: "2. AI detects your pulls", icon: Brain, body: "Vision model suggests cards, rarity, value, and confidence scores." },
            { title: "3. RipSense analyzes your luck", icon: Activity, body: "Compare your performance against global pull distributions." },
          ].map((step) => {
            const Icon = step.icon;
            return (
              <Card key={step.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-white">
                    <Icon className="h-4 w-4 text-[--accent-blue]" />
                    {step.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-white/70">{step.body}</CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-6 text-center">
          <h2 className="text-3xl font-semibold text-white md:text-4xl">Feature highlights</h2>
          <p className="mt-2 text-white/60">Built for serious collectors who track performance, not just pulls.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {featureHighlights.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="transition hover:-translate-y-0.5">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-[--accent-purple]" />
                    {feature.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-white/70">{feature.description}</CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
