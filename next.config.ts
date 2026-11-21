import type { NextConfig } from 'next';
const config: NextConfig = { serverExternalPackages: ['node:sqlite'], poweredByHeader: false, outputFileTracingExcludes: { '*': ['.local/**', '.env*', 'config/local.json'] } };
export default config;
