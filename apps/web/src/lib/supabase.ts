import { createBrowserClient } from '@supabase/ssr';
let client:ReturnType<typeof createBrowserClient>|null = null;
export const authConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export function getSupabase() {
  if (!authConfigured) return null;
  client ||= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  return client;
}
