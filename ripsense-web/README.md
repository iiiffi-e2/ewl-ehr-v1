# RipSense Web (MVP)

RipSense is an AI-powered analytics platform for trading card collectors, starting with Pokemon TCG.

This frontend MVP includes:

- Authentication UI (Supabase email + Google OAuth)
- Landing page with animated product preview
- User dashboard with luck analytics and charts
- Pack logging (manual + AI recognition placeholder)
- Global pull analytics + heat map
- Pack simulator
- Profile page + shareable pull cards
- API placeholders for AI vision and LLM summaries

## Stack

- Next.js App Router + React + TypeScript
- Tailwind CSS
- shadcn-style UI components
- Framer Motion animations
- Recharts visualizations
- Supabase client integration

## Run locally

```bash
cd ripsense-web
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000

## Environment variables

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

If Supabase variables are missing, auth screens still render and show setup guidance.

## Supabase schema

A starter SQL schema is included at:

`supabase/schema.sql`

It creates:

- users
- packs
- pulls
- boxes
- global_stats

with row-level security policies for private user data and public read-only global stats.

## API placeholders

- `POST /api/ai/detect` — mock card detection response from uploaded image
- `GET /api/insights` — mock LLM analytics summary
- `GET /api/packs` / `POST /api/packs` — mock pack listing + create endpoint
- `GET /api/share/:pullId` — generated share card image

## Notes

- The MVP is intentionally built with mocked analytics and detection data so UI and flows are production-grade while backend integrations can be connected incrementally.
- Replace mock data sources with Supabase queries and external card/pricing APIs as next step.
