import express from "express";
import helmet from "helmet";
import cors from "cors";
import { authRouter } from "./routes/auth.js";
import { uploadRouter } from "./routes/upload.js";
import { downloadRouter } from "./routes/download.js";
import { tusServer } from "./routes/tus.js";

const app = express();
app.use(helmet());

// Browser requests from the web frontend (a different origin — different
// port counts as a different origin) are blocked by default unless the API
// explicitly allows it. FRONTEND_URL supports a comma-separated list so both
// a local dev origin and a production domain can be allowed at once.
const allowedOrigins = (process.env.FRONTEND_URL ?? "http://localhost:3000")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      // tus resumable-upload protocol headers — without these, chunked
      // uploads fail the same CORS way even after auth/JSON routes work.
      "Tus-Resumable",
      "Upload-Length",
      "Upload-Metadata",
      "Upload-Offset",
      "Upload-Concat",
      "X-HTTP-Method-Override",
    ],
    exposedHeaders: [
      "Location",
      "Upload-Offset",
      "Upload-Length",
      "Tus-Resumable",
      "Tus-Version",
      "Tus-Max-Size",
      "Tus-Extension",
    ],
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// JSON body parsing is scoped to routes that need it — tus PATCH bodies are
// raw application/offset+octet-stream chunks and must never pass through a
// body parser, or the byte stream gets consumed before tus can read it.
app.use("/api/auth", express.json(), authRouter);
app.use("/api/upload", express.json(), uploadRouter);
app.use("/api/files", downloadRouter);

// tus resumable-upload protocol: POST creates, PATCH streams chunks, HEAD
// reports offset for resuming, DELETE cancels. tusServer owns the full
// request/response lifecycle for this path.
app.all("/api/tus/*", (req, res) => tusServer.handle(req, res));

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => console.log(`Vault API listening on :${port}`));