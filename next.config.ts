import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM-backed packages used for PDF -> image rendering. Keep them
  // out of the server bundle so their prebuilt binaries resolve correctly
  // in Node.js serverless environments (e.g. Vercel).
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
