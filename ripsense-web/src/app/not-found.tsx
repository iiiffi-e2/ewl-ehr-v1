import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg py-20 text-center">
      <h1 className="text-3xl font-semibold">Pull not found</h1>
      <p className="mt-2 text-white/65">That share card doesn&apos;t exist yet or has been removed.</p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
