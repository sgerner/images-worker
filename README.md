# images-worker

Tiny image upload + processing service for `images.stevengerner.com`.

## Endpoints
- `GET /healthz` -> `{ ok: true }`
- `GET /manifest.json`
- `GET /processed-images/<file>.webp`
- `POST /upload`  (multipart form, field `file`, Bearer auth)

## Auth
Set `AUTH_TOKEN` env and send `Authorization: Bearer <token>` on uploads.

## Env Vars
- `BASE_URL` e.g. `https://images.stevengerner.com`
- `AUTH_TOKEN` long random string
- `DATA_DIR` default `/data`
- `PORT` default `3000`

## Deploy on CapRover
1. Create app `images`
2. App Config:
   - Persistent directory: `/data`
   - Container HTTP port: `3000`
   - Env: `BASE_URL`, `AUTH_TOKEN`, `DATA_DIR=/data`
3. Domains/SSL: add `images.stevengerner.com`, enable Let’s Encrypt
4. Connect Git provider in CapRover and add the provided webhook to this repo.

## Test
```bash
bash scripts/test-upload.sh ./sample.jpg
