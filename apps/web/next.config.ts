import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pacotes de workspace consumidos a partir do código-fonte TS.
  transpilePackages: [
    '@nutrimed/shared-types',
    '@nutrimed/domain',
    '@nutrimed/crypto',
    '@nutrimed/db',
    '@nutrimed/auth',
  ],
  // Drivers de banco rodam no servidor — não empacotar (require nativo em runtime).
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
};

export default nextConfig;
