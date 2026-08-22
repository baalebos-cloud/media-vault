"use client";

import { useCallback, useState } from "react";
import * as tus from "tus-js-client";

type UploadStatus = "uploading" | "paused" | "processing" | "ready" | "error";

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: UploadStatus;
  previewUrl?: string;
  upload: tus.Upload;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export default function Uploader({ token, folderId }: { token: string; folderId?: string }) {
  const [items, setItems] = useState<UploadItem[]>([]);

  const patch = (id: string, changes: Partial<UploadItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...changes } : i)));

  const pollFileStatus = useCallback(
    (itemId: string, objectKey: string) => {
      let attempts = 0;
      const maxAttempts = 30;

      const check = async () => {
        attempts++;
        if (attempts > maxAttempts) {
          patch(itemId, { status: "error" });
          return;
        }
        try {
          const res = await fetch(`${API_URL}/api/files/by-key/${encodeURIComponent(objectKey)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return setTimeout(check, 2000);
          const data = await res.json();
          if (data.status === "READY") patch(itemId, { status: "ready" });
          else if (data.status === "FAILED") patch(itemId, { status: "error" });
          else setTimeout(check, 2000);
        } catch {
          setTimeout(check, 2000);
        }
      };
      check();
    },
    [token]
  );

  const uploadFile = useCallback(
    (file: File) => {
      const localId = crypto.randomUUID();
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;

      const upload = new tus.Upload(file, {
        endpoint: `${API_URL}/api/tus`,
        storeFingerprintForResuming: true,
        removeFingerprintOnSuccess: true,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        chunkSize: 8 * 1024 * 1024,
        headers: { Authorization: `Bearer ${token}` },
        metadata: {
          filename: file.name,
          filetype: file.type || "application/octet-stream",
          ...(folderId ? { folderId } : {}),
        },
        onError: () => patch(localId, { status: "error" }),
        onProgress: (bytesSent, bytesTotal) => {
          patch(localId, { progress: Math.round((bytesSent / bytesTotal) * 100) });
        },
        onSuccess: () => {
          patch(localId, { status: "processing" });
          const objectKey = upload.url?.split("/").pop();
          if (objectKey) pollFileStatus(localId, objectKey);
        },
      });

      setItems((prev) => [
        ...prev,
        { id: localId, file, progress: 0, status: "uploading", previewUrl, upload },
      ]);

      upload.findPreviousUploads().then((previous) => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      });
    },
    [token, folderId, pollFileStatus]
  );

  const pause = (id: string) => {
    const item = items.find((i) => i.id === id);
    item?.upload.abort();
    patch(id, { status: "paused" });
  };

  const resume = (id: string) => {
    const item = items.find((i) => i.id === id);
    item?.upload.start();
    patch(id, { status: "uploading" });
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      Array.from(e.dataTransfer.files).forEach(uploadFile);
    },
    [uploadFile]
  );

  return (
    <div>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{ border: "2px dashed #999", borderRadius: 12, padding: 32, textAlign: "center", cursor: "pointer" }}
        onClick={() => document.getElementById("vault-file-input")?.click()}
      >
        <p>Drag & drop files here, or click to browse</p>
        <input
          id="vault-file-input"
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => Array.from(e.target.files ?? []).forEach(uploadFile)}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12, marginTop: 16 }}>
        {items.map((item) => (
          <div key={item.id} style={{ borderRadius: 8, overflow: "hidden", background: "#111" }}>
            {item.previewUrl ? (
              <img src={item.previewUrl} alt={item.file.name} style={{ width: "100%", height: 100, objectFit: "cover" }} />
            ) : (
              <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
                {item.file.name.split(".").pop()?.toUpperCase()}
              </div>
            )}
            <div style={{ padding: 8, fontSize: 12, color: "#ccc" }}>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.file.name}</div>

              {item.status === "uploading" && (
                <>
                  <div style={{ background: "#333", borderRadius: 4, marginTop: 4 }}>
                    <div style={{ width: `${item.progress}%`, height: 4, background: "#4ade80", borderRadius: 4 }} />
                  </div>
                  <button onClick={() => pause(item.id)} style={{ marginTop: 4, fontSize: 11 }}>
                    Pause ({item.progress}%)
                  </button>
                </>
              )}
              {item.status === "paused" && (
                <button onClick={() => resume(item.id)} style={{ fontSize: 11 }}>
                  Resume ({item.progress}%)
                </button>
              )}
              {item.status === "processing" && <span>Processing…</span>}
              {item.status === "ready" && <span style={{ color: "#4ade80" }}>Ready</span>}
              {item.status === "error" && (
                <button onClick={() => resume(item.id)} style={{ fontSize: 11, color: "#f87171" }}>
                  Failed — retry
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}