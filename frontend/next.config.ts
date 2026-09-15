import type { NextConfig } from 'next';

/**
 * O frontend só renderiza telas. Toda chamada a /api/* é repassada ao backend
 * (servidor Node separado): o navegador fala com uma única origem, o cookie de
 * sessão fica SameSite=Strict e não é preciso liberar CORS.
 */
const backendUrl = process.env.BACKEND_URL ?? 'http://127.0.0.1:3333';
const isProduction = process.env.NODE_ENV === 'production';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Câmera liberada apenas para a própria origem (leitura de código de barras no futuro).
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProduction ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // O indicador de desenvolvimento do Next sobrepõe o card do usuário no menu.
  devIndicators: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
  },
};

export default nextConfig;
