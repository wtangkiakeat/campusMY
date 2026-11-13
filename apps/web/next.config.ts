import type { NextConfig } from 'next';

function origin(value:string|undefined) {
  if (!value) return '';
  try { return new URL(value).origin; } catch { return ''; }
}
const apiOrigin = origin(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000');
const supabaseOrigin = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${apiOrigin} ${supabaseOrigin} ${supabaseOrigin.replace(/^http/, 'ws')} ${process.env.NODE_ENV === 'development' ? 'ws://localhost:3000 ws://127.0.0.1:3000' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
const nextConfig: NextConfig = {
  distDir: process.env.CAMPUSMY_NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: csp },
    ] }];
  },
};
export default nextConfig;
