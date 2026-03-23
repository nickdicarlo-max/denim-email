import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@denim/types", "@denim/engine", "@denim/ai"],
};

export default nextConfig;
