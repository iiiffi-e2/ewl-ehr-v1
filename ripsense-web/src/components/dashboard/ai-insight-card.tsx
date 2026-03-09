"use client";

import { useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AiInsightCard() {
  const [summary, setSummary] = useState<string>("Loading AI summary...");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const run = async () => {
      try {
        const response = await fetch("/api/insights");
        const data = (await response.json()) as { summary?: string };
        setSummary(data.summary ?? "No summary available.");
      } catch {
        setSummary("Could not load AI summary.");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-[--accent-blue]" />
          AI Performance Insight
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating summary...
          </p>
        ) : (
          <p className="text-sm text-white/75">{summary}</p>
        )}
      </CardContent>
    </Card>
  );
}
