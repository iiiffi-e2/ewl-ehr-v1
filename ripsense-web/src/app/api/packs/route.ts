import { NextResponse } from "next/server";

import { samplePacks } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json({
    data: samplePacks,
    source: "mock-data",
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  return NextResponse.json({
    status: "queued",
    message: "Pack log accepted. In production this is persisted to Supabase.",
    payload: body,
  });
}
