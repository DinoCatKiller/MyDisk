/**
 * 分片上传的二进制面传输层（不经 oRPC）。
 *
 * - `POST {origin}/api/upload/chunk?uploadId=&index=`，body 为该分片 Blob，
 *   `Content-Type: application/octet-stream`，并带 `withCredentials`。
 * - 用 XHR 而非 fetch，是为了拿到 `upload.onprogress` 做分片级进度。
 */
import { ENV } from "~/env";

export type ChunkUploadResult = {
  received: number;
  etag: string;
};

export type ProgressHandler = (loaded: number, total: number) => void;

export type UploadChunkOptions = {
  uploadId: string;
  index: number;
  blob: Blob;
  onProgress?: ProgressHandler;
  signal?: AbortSignal;
};

/** 推导二进制面所在的服务端 origin（绝对地址优先，否则回落同源）。 */
export function resolveServerOrigin(): string {
  const configured = ENV.VITE_SERVER_URL ?? "";
  if (/^https?:\/\//i.test(configured)) {
    return configured.replace(/\/+$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return configured.replace(/\/+$/, "");
}

export function uploadChunk(options: UploadChunkOptions): Promise<ChunkUploadResult> {
  const { uploadId, index, blob, onProgress, signal } = options;
  const origin = resolveServerOrigin();
  const url = `${origin}/api/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`;

  return new Promise<ChunkUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      signal?.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      xhr.abort();
    };

    xhr.open("POST", url, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(event.loaded, event.total);
        }
      };
    }

    xhr.onload = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        let etag = "";
        try {
          const data = JSON.parse(xhr.responseText) as { etag?: string };
          etag = data.etag ?? "";
        } catch {
          etag = "";
        }
        resolve({ received: blob.size, etag });
      } else {
        reject(new Error(`分片上传失败（HTTP ${xhr.status}）`));
      }
    };

    xhr.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new Error("网络错误，分片上传失败"));
    };

    xhr.onabort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(new DOMException("已取消", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException("已取消", "AbortError"));
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    xhr.send(blob);
  });
}

/** 计算整文件 SHA-256（用于秒传）；不可用时返回空串。 */
export async function computeSha256(blob: Blob, onProgress?: ProgressHandler): Promise<string> {
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (!subtle) {
    return "";
  }
  const buffer = await blob.arrayBuffer();
  onProgress?.(buffer.byteLength, blob.size);
  const digest = await subtle.digest("SHA-256", buffer);
  let out = "";
  for (const byte of new Uint8Array(digest)) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}
