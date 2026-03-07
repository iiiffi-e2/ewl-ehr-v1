"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const colors = ["#7b61ff", "#00c2ff", "#ffcf57", "#37d67a", "#b4bcd0"];

export function HitRateChart({ data }: { data: Array<{ rarity: string; count: number }> }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="rarity"
            cx="50%"
            cy="50%"
            innerRadius={58}
            outerRadius={92}
            paddingAngle={2}
          >
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "#111326",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
