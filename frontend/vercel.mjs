/**
 * Vercel configuration for the frontend (replaces vercel.json; Vercel runs this file at build time).
 *
 * The backend's address comes from the API_PROXY_TARGET environment variable of this Vercel
 * project, e.g. https://api-gradify-evsu.vercel.app — it is not written in the code. Requests to
 * /api on the frontend's own domain are forwarded there, so the browser stays on one origin and
 * the secure session cookie keeps working. Changing the variable takes effect on the next deploy.
 */
const target = (process.env.API_PROXY_TARGET ?? '').trim().replace(/\/+$/, '').replace(/\/api$/, '');

if (!/^https:\/\/[^/\s]+$/.test(target)) {
  throw new Error(
    'API_PROXY_TARGET must be set to the backend address, like https://api-gradify-evsu.vercel.app ' +
      '(Vercel → frontend project → Settings → Environment Variables), then redeploy.',
  );
}

export const config = {
  rewrites: [
    { source: '/api/:path*', destination: `${target}/api/:path*` },
    { source: '/(.*)', destination: '/index.html' },
  ],
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    },
    {
      source: '/assets/(.*)',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
  ],
};
