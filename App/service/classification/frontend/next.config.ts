import type { NextConfig } from "next";

const backendUrl =
  process.env.CLASSIFICATION_BACKEND_URL ?? "http://127.0.0.1:3031";

const llmUrl = process.env.LLM_BASE_URL ?? "http://127.0.0.1:4100";

const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // SSE (chat Dexmin) tidak boleh di-gzip: kompresi me-buffer
  // stream tak berujung sehingga browser tak pernah menerima event.
  compress: false,

  async rewrites() {
    return [
      // 5R Rapi: rewrite LLM HARUS di atas rule umum — kalau kebalik,
      // /api/llm/* ditelan /api/:path* dan nyasar ke :3031.
      // Same-origin :3030 → :4100 agar browser lolos CORS (loopback tanpa ACAO).
      // Teruskan path+query apa adanya (GET murni, tanpa preflight).
      {
        source: "/api/llm/:path*",
        destination: `${llmUrl}/:path*`,
      },
      {
        source: "/api/:path*",
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
