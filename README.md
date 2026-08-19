# Media Vault — Private Cloud Storage & Streaming

Production-grade personal cloud storage: direct-to-storage uploads, EXIF/video
metadata indexing, photo lightbox, and adaptive HLS video streaming — all
reachable from anywhere without exposing your home network.

## Architecture

```
                         ┌────────────────────┐
                         │   Browser Client    │
                         │  (Next.js / React)  │
                         └─────────┬────────────┘
                    (1) request presigned URL │  (4) GET /files/:id
                                   ▼                       ▲
                         ┌────────────────────┐            │
                         │   API (Express)     │────────────┘
                         │  - auth (JWT)        │
                         │  - presign upload/dl │
                         │  - confirm + enqueue  │
                         └───┬────────────┬─────┘
              (2) PUT bytes  │            │ enqueue job
              directly       ▼            ▼
                    ┌────────────┐  ┌──────────────┐
                    │ MinIO / S3 │  │ Redis (BullMQ)│
                    │ (raw +     │  └──────┬───────┘
                    │  derived)  │         │ (3) process
                    └─────▲──────┘         ▼
                          │        ┌──────────────────┐
                          └────────│  Media Worker     │
                                   │  Sharp (thumbs)    │
                                   │  FFmpeg (HLS)      │
                                   └─────────┬──────────┘
                                             ▼
                                   ┌──────────────────┐
                                   │  PostgreSQL        │
                                   │  files/metadata/... │
                                   └──────────────────┘
```

**Auth:** `POST /api/auth/register` and `/login` return a JWT (`sub` = user id,
7-day expiry); `GET /api/auth/me` returns the current user. All upload/download/tus
routes require `Authorization: Bearer <token>`.

**Upload flow — resumable, via the tus protocol (browser path):**
1. `tus-js-client` `POST`s to `/api/tus` with the bearer token + file metadata (name, type, folder).
2. `onUploadCreate` on the server verifies the JWT, creates a `PENDING` File row, and namespaces the S3 object key under `raw/<userId>/...`.
3. The client streams the file in chunks via `PATCH` requests (`S3Store` backs each chunk with an S3 multipart part) — if the connection drops, `findPreviousUploads()` + `resumeFromPreviousUpload()` picks up from the last completed chunk instead of restarting.
4. On the final chunk, `onUploadFinish` flips the File to `UPLOADED`/`PROCESSING` and enqueues a BullMQ job — functionally the same handoff the old `/confirm` endpoint did.
5. The Media Worker pulls the job, generates thumbnails (Sharp) or an HLS ladder (FFmpeg: 360p/720p/1080p), uploads derived assets back to storage, and writes `FileMetadata` (EXIF, dimensions, duration, codec).
6. Client polls/reads `GET /api/files/:id` for presigned download URLs and the HLS manifest path.

**Legacy non-resumable path:** `POST /api/upload/initiate` + `/confirm` (plain
presigned `PUT`) is still there for small files or non-browser/API clients that
don't need resumability — same downstream processing pipeline.

**Playback:** video segments are proxied through `/api/files/:id/stream/:segment`
rather than one long-lived signed URL, so every segment request re-checks auth
and uses a short (5 min) expiry.

## Directory structure

```
media-vault/
├── docker-compose.yml          # Postgres, Redis, MinIO, API, worker, web, cloudflared
├── .env.example
├── packages/
│   ├── api/                    # Backend: Express + Prisma + BullMQ
│   │   ├── prisma/schema.prisma
│   │   ├── src/
│   │   │   ├── server.ts       # Express entrypoint
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts     # register / login / me
│   │   │   │   ├── tus.ts      # resumable upload protocol (primary path)
│   │   │   │   ├── upload.ts   # presign + confirm (legacy, non-resumable)
│   │   │   │   └── download.ts # presigned GET + HLS proxy
│   │   │   ├── worker/
│   │   │   │   ├── queue.ts
│   │   │   │   └── mediaWorker.ts  # Sharp thumbnails + FFmpeg HLS
│   │   │   ├── lib/
│   │   │   │   ├── s3.ts
│   │   │   │   ├── jwt.ts
│   │   │   │   └── prisma.ts
│   │   │   └── middleware/auth.ts
│   │   ├── Dockerfile
│   │   └── Dockerfile.worker
│   └── web/                    # Frontend: Next.js
│       └── components/Uploader.tsx
```

## Local / production setup

```bash
cp .env.example .env       # fill in real secrets
docker compose up -d postgres redis minio minio-bucket-init
cd packages/api
npm install
npx prisma migrate dev --name init
npm run dev                # API on :4000
npm run worker              # separate terminal — media worker

cd ../web
npm install
npm run dev                # web on :3000
```

For production, build and run everything through `docker compose up -d --build`,
then point a Cloudflare Tunnel (`CLOUDFLARE_TUNNEL_TOKEN` in `.env`) at the
`web` and `api` services — no inbound ports need to be opened on your router.

## Next steps to harden before going live

- Add refresh-token rotation and rate limiting on `/api/upload/initiate`.
- Enforce per-user storage quotas (sum `sizeBytes` before issuing new presigns).
- Add a Postgres full-text/GIN index on `File.originalName` + `Tag.name` for global search.
- Add virus scanning (e.g. ClamAV) as a worker step before flipping status to `READY`.
- Set MinIO bucket lifecycle rules to expire abandoned `PENDING` objects.
