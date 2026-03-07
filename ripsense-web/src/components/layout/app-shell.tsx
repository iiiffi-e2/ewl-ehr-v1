"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Globe2, Home, LogIn, PackagePlus, Sparkles, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/log-pack", label: "Log Pack", icon: PackagePlus },
  { href: "/global-stats", label: "Global Stats", icon: Globe2 },
  { href: "/simulator", label: "Simulator", icon: Sparkles },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  if (isLanding) {
    return <>{children}</>;
  }

  return (
    <div className="relative min-h-screen">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,rgba(123,97,255,0.23),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(0,194,255,0.15),transparent_42%),#0b0a14]" />
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0f1020]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="rounded-lg bg-[--accent-purple] p-2">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-white">RipSense</p>
              <p className="text-[11px] text-white/50">AI Pull Intelligence</p>
            </div>
          </Link>

          <nav className="hidden gap-1 md:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/70 transition hover:text-white",
                    active && "bg-white/10 text-white",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <Button asChild variant="secondary" size="sm">
            <Link href="/auth">
              <LogIn className="mr-1 h-4 w-4" />
              Sign in
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">{children}</main>

      <nav className="fixed right-3 bottom-3 left-3 z-40 rounded-2xl border border-white/10 bg-[#121327]/90 p-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] text-white/70",
                  active && "bg-white/10 text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
