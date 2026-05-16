import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
};

export default withNextIntl(nextConfig);
