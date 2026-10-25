# CampusFlow LIVE — Verden Campus

Teacher/student assignment session MVP. Built from scratch for a responsive iPad-first PWA.

## Stack
- Node.js 20+ / Express API
- Supabase PostgreSQL + private Storage
- Render for the API
- Static frontend can be hosted by the same Node service or deployed separately

## Local setup
1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. Copy `.env.example` to `.env` and set the values.
4. Run `npm install`, then `npm run dev`.
5. Open `http://localhost:3000`.

## Environment
- `SUPABASE_URL`: project URL
- `SUPABASE_SERVICE_ROLE_KEY`: server-only service role key; never expose in frontend
- `TEACHER_ACCESS_KEY`: private teacher access key
- `APP_ORIGIN`: optional exact browser origin, e.g. `https://your-site.example`
- `STORAGE_BUCKET`: defaults to `assignments`

## Deploy
- Render: create a Web Service from this repository; `render.yaml` supplies the service settings.
- Add the environment variables in Render.
- Run the SQL schema before testing sessions.
- Keep the Supabase service role key only in Render's secret environment variables.

## Security notes
- PINs and teacher tokens are stored as SHA-256 hashes.
- Student and teacher routes are rate limited; uploads are limited to PDF/PNG/JPG up to 5 MiB.
- Tables have RLS enabled and no browser policies; all data access is through the server.
- `GET /ping` returns 200 only from 08:00 through 13:15 in Europe/Berlin time.
- PWA caching is only for the static app shell; API requests are not cached.

## MVP limitations to address before production
- Add stronger teacher identity/authentication and session recovery.
- Add submission idempotency and transactional file cleanup on failed DB writes.
- Add antivirus/content inspection and file-signature validation; MIME and extension checks alone are not sufficient.
- Create and add the PNG icons referenced by the manifest.
- Configure production CORS with the exact frontend origin.
