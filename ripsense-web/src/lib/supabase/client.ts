import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createSupabaseBrowserClient() {
  if (!url || !key) {
    return null;
  }
  return createBrowserClient(url, key);
}

export function hasSupabaseConfig() {
  return Boolean(url && key);
}
