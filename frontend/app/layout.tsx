import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { connection } from 'next/server';
import { Providers } from '@/components/providers';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'StockGuard', template: '%s · StockGuard' },
  description: 'Controle de estoque com prevenção de divergências.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Renderização dinâmica: cada requisição recebe um nonce de CSP novo (proxy.ts).
  await connection();
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-neutral-50 text-neutral-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
