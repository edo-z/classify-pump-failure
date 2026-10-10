# Classification Frontend (Next.js 16 + React 19)

Routes: `/documents`, `/chat`, `/admin` (`src/app/`).
Lib: `src/app/api.ts`, `replay.ts`, `chat.ts`.
Run: `bun install` lalu `bun run dev` (port 3030, API 3031).
Scripts: `dev|build|start|typecheck|test:e2e`.
E2E: `e2e/ui-*.spec.ts` + `bun run test:e2e` (butuh backend 3031).
Lockfile: `bun.lock` saja (npm dihapus).
Env: ikuti `backend/.env.example` untuk host/port API.
Catatan: `documents/page.tsx` + `replay.ts` god-file — rencana pecah
ke `hooks/useDocuments`, `components/Chart`, `lib/replay/*`.
