"use client";

import { useCallback, useEffect, useState } from "react";

interface VaultFile {
  id: string;
  name: string;
  kind: string;
  status: string;
  sizeBytes: string;
  createdAt: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let val = bytes;
  let i = -1;
  do {
    val /= 1024;
    i++;
  } while (val >= 1024 && i < units.length - 1);
  return `${val.toFixed(1)} ${units[i]}`;
}

export default function FileList({ token, refreshKey }: { token: string; refreshKey?: number }) {
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/files`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files);
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const download = async (fileId: string) => {
    setDownloadingId(fileId);
    try {
      const res = await fetch(`${API_URL}/api/files/${fileId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      window.open(data.originalUrl, "_blank");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Your files</h2>
        <button onClick={load} style={{ fontSize: 12, background: "none", border: "1px solid #333", color: "#ccc", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}>
          Refresh
        </button>
      </div>

      {loading && files.length === 0 && <p style={{ color: "#666", fontSize: 13 }}>Loading…</p>}
      {!loading && files.length === 0 && <p style={{ color: "#666", fontSize: 13 }}>No files uploaded yet.</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {files.map((f) => (
          <div
            key={f.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 12px",
              background: "#111",
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              <span>{f.name}</span>
              <span style={{ color: "#666", marginLeft: 8 }}>
                {formatBytes(Number(f.sizeBytes))} · {new Date(f.createdAt).toLocaleDateString()}
              </span>
            </div>
            {f.status === "READY" ? (
              <button
                onClick={() => download(f.id)}
                disabled={downloadingId === f.id}
                style={{ fontSize: 12, background: "#4ade80", color: "#111", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}
              >
                {downloadingId === f.id ? "Opening…" : "Download"}
              </button>
            ) : (
              <span style={{ fontSize: 12, color: "#999" }}>{f.status}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}