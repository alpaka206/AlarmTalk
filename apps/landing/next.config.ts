import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// Workspace root, where hoisted node_modules (incl. next) lives. Turbopack (Next 16
// default) can't infer it in this monorepo, and it must match outputFileTracingRoot.
const workspaceRoot = path.join(__dirname, "..", "..");

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
};

export default withNextIntl(nextConfig);
