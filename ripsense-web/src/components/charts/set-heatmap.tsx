import { cn } from "@/lib/utils";

type HeatCell = {
  setName: string;
  productType: string;
  avgPacksPerHit: number;
};

function getIntensity(avgPacksPerHit: number) {
  // Lower packs-per-hit means hotter.
  if (avgPacksPerHit <= 4.5) return "bg-[#37d67a]/30 border-[#37d67a]/40";
  if (avgPacksPerHit <= 5.5) return "bg-[#00c2ff]/25 border-[#00c2ff]/35";
  if (avgPacksPerHit <= 6.5) return "bg-[#ffcf57]/20 border-[#ffcf57]/35";
  return "bg-[#ff6b8a]/20 border-[#ff6b8a]/35";
}

export function SetHeatMap({ data }: { data: HeatCell[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((item) => (
        <div
          key={`${item.setName}-${item.productType}`}
          className={cn(
            "rounded-xl border p-4 transition-transform hover:-translate-y-0.5",
            getIntensity(item.avgPacksPerHit),
          )}
        >
          <p className="text-sm text-white/60">{item.setName}</p>
          <p className="font-semibold text-white">{item.productType}</p>
          <p className="mt-2 text-sm text-white/80">1 hit every {item.avgPacksPerHit.toFixed(1)} packs</p>
        </div>
      ))}
    </div>
  );
}
