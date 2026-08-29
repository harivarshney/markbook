import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/process": ["./node_modules/pdfjs-dist/standard_fonts/**"],
  },
};

export default nextConfig;