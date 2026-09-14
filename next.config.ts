import type { NextConfig } from 'next';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? '';
const pagesPath = process.env.GITHUB_ACTIONS === 'true' && repositoryName ? `/${repositoryName}` : '';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: pagesPath,
  assetPrefix: pagesPath,
};

export default nextConfig;
