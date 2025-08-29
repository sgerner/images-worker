import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import multer from "multer";
import sharp from "sharp";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import slugify from "slugify";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";
const DATA_DIR = process.env.DATA_DIR || "/data";
const OUTPUT_DIR = path.join(DATA_DIR, "processed-images");
const MANIFEST_PATH = path.join(DATA_DIR, "manifest.json");
const TMP_DIR = path.join(DATA_DIR, "tmp");

const sizes = { thumb: 200, sm: 640, md: 768, lg: 1024, xl: 1280 };
const supported = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tiff",
  ".tif",
  ".avif",
]);

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await fs.mkdir(TMP_DIR, { recursive: true });
if (!fssync.existsSync(MANIFEST_PATH)) await fs.writeFile(MANIFEST_PATH, "[]");

let manifestLock = Promise.resolve();
const withLock = (fn) => {
  const run = async () =>
    fn().catch((e) => {
      throw e;
    });
  const p = manifestLock.then(run, run);
  manifestLock = p.catch(() => {});
  return p;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const app = express();
app.set("trust proxy", true);
app.use(helmet());
app.use(cors({ origin: "*", methods: ["GET", "POST", "PUT", "DELETE"] }));
app.use(compression());
app.use(express.json());

app.use(
  "/processed-images",
  express.static(OUTPUT_DIR, {
    maxAge: "365d",
    immutable: true,
    setHeaders: (res) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    },
  })
);

app.get("/healthz", (_req, res) => res.json({ ok: true }));
app.get("/manifest.json", async (_req, res) => {
  try {
    const data = await fs.readFile(MANIFEST_PATH, "utf-8");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch {
    res.status(500).json({ error: "cannot read manifest" });
  }
});

function requireAuth(req, res, next) {
  const hdr = req.get("authorization") || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
  if (!AUTH_TOKEN || token === AUTH_TOKEN) return next();
  res.status(401).json({ error: "unauthorized" });
}

app.put("/images/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, tags, gps } = req.body;

    await withLock(async () => {
      const text = await fs.readFile(MANIFEST_PATH, "utf-8");
      const manifest = JSON.parse(text);
      const idx = manifest.findIndex((x) => x.id === id);

      if (idx === -1) {
        return res.status(404).json({ error: "image not found" });
      }

      const updatedEntry = { ...manifest[idx] };
      if (title) updatedEntry.title = title;
      if (description) updatedEntry.description = description;
      if (tags) updatedEntry.tags = tags;
      if (gps) updatedEntry.gps = gps;

      manifest[idx] = updatedEntry;

      const tmpPath = path.join(TMP_DIR, `manifest-${Date.now()}.json`);
      await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2));
      await fs.rename(tmpPath, MANIFEST_PATH);

      res.json({ ok: true, image: updatedEntry });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "update_failed" });
  }
});

app.delete("/images/:id", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    await withLock(async () => {
      const text = await fs.readFile(MANIFEST_PATH, "utf-8");
      let manifest = JSON.parse(text);
      const idx = manifest.findIndex((x) => x.id === id);

      if (idx === -1) {
        return res.status(404).json({ error: "image not found" });
      }

      const entry = manifest[idx];
      const urls = Object.values(entry.urls);

      for (const url of urls) {
        const filename = path.basename(url);
        const filepath = path.join(OUTPUT_DIR, filename);
        try {
          await fs.unlink(filepath);
        } catch (e) {
          if (e.code !== "ENOENT") {
            console.error(`Failed to delete file ${filepath}`, e);
          }
        }
      }

      manifest = manifest.filter((x) => x.id !== id);

      const tmpPath = path.join(TMP_DIR, `manifest-${Date.now()}.json`);
      await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2));
      await fs.rename(tmpPath, MANIFEST_PATH);

      res.json({ ok: true });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "delete_failed" });
  }
});

app.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "no file" });

    const originalName = req.file.originalname || "upload";
    const ext = path.extname(originalName).toLowerCase();
    if (!supported.has(ext))
      return res.status(400).json({ error: "unsupported file type" });

    const baseName = path.basename(originalName, ext);
    const customId = (req.body.id || "").trim();
    const id = slugify(customId || baseName, { lower: true, strict: true });

    const title = req.body.title || baseName;
    const description = req.body.description || "";
    const tags = (req.body.tags || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const lat = req.body.lat ? parseFloat(req.body.lat) : undefined;
    const lon = req.body.lon ? parseFloat(req.body.lon) : undefined;

    const inputSharp = sharp(req.file.buffer, { failOn: "warning" }).rotate();

    const originalNameOut = `${id}-original.webp`;
    const originalPath = path.join(OUTPUT_DIR, originalNameOut);
    await inputSharp.webp({ quality: 90 }).toFile(originalPath);

    const urls = {
      original: `/processed-images/${originalNameOut}`,
    };

    for (const [size, width] of Object.entries(sizes)) {
      const outName = `${id}-${size}.webp`;
      const outPath = path.join(OUTPUT_DIR, outName);
      await sharp(req.file.buffer)
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(outPath);
      urls[size] = `/processed-images/${outName}`;
    }

    const now = new Date().toISOString();
    const newEntry = {
      id,
      title,
      description,
      tags: tags.length ? tags : ["untagged"],
      createdAt: now,
      urls,
    };

    if (lat && lon) {
      newEntry.gps = { lat, lon };
    }

    await withLock(async () => {
      const text = await fs.readFile(MANIFEST_PATH, "utf-8");
      const manifest = JSON.parse(text);
      const idx = manifest.findIndex((x) => x.id === newEntry.id);
      if (idx >= 0) manifest[idx] = { ...manifest[idx], ...newEntry };
      else manifest.push(newEntry);
      const tmpPath = path.join(TMP_DIR, `manifest-${Date.now()}.json`);
      await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2));
      await fs.rename(tmpPath, MANIFEST_PATH);
    });

    res.json({ ok: true, id, urls });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "processing_failed" });
  }
});

app.listen(PORT, () => {
  console.log(`images-worker listening on ${PORT}`);
});
