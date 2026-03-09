"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ValuePoint = {
  day: string;
  value: number;
  cumulative: number;
};

export function ValueOverTimeChart({ data }: { data: ValuePoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid stroke="rgba(255,255,255,0.07)" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) => `$${value}`}
          />
          <Tooltip
            contentStyle={{ background: "#111326", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12 }}
            formatter={(value, key) => [
              `$${Number(value).toFixed(2)}`,
              key === "cumulative" ? "Cumulative" : "Pack Value",
            ]}
          />
          <Line type="monotone" dataKey="value" stroke="#00c2ff" strokeWidth={2.2} dot={false} />
          <Line type="monotone" dataKey="cumulative" stroke="#7b61ff" strokeWidth={2.2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
