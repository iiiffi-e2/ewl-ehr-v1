"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type GlobalChartPoint = {
  setName: string;
  packsLoggedM: number;
};

export function GlobalStatsChart({ data }: { data: GlobalChartPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
          <XAxis dataKey="setName" tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: "rgba(255,255,255,0.6)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => `${value}M`}
          />
          <Tooltip
            contentStyle={{ background: "#111326", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
            formatter={(value) => [`${Number(value).toFixed(2)}M`, "Packs Logged"]}
          />
          <Bar dataKey="packsLoggedM" fill="url(#packsGradient)" radius={[8, 8, 0, 0]} />
          <defs>
            <linearGradient id="packsGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00c2ff" stopOpacity={0.95} />
              <stop offset="95%" stopColor="#7b61ff" stopOpacity={0.55} />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
