import type { NextConfig } from 'next';
const config: NextConfig = { turbopack: { root: process.cwd() }, serverExternalPackages: ['node:sqlite'], poweredByHeader: false, outputFileTracingExcludes: { '*': ['.local/**', '.env*', 'config/local.json'] } };
export default config;
