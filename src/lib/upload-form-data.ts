export type UploadProgressUpdate = {
  loaded: number;
  total: number;
  percentage: number;
};

export type UploadResponse<T> = {
  status: number;
  ok: boolean;
  data: T | null;
};

export function uploadFormDataWithProgress<T = unknown>(
  url: string,
  formData: FormData,
  onProgress?: (progress: UploadProgressUpdate) => void,
): Promise<UploadResponse<T>> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url, true);
    // Never leave an upload control spinning forever after a stalled TCP
    // connection or a proxy that accepts but never completes the request.
    request.timeout = 5 * 60 * 1000;
    request.withCredentials = true;
    request.setRequestHeader("Accept", "application/json");

    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const total = Math.max(0, event.total);
      const loaded = Math.min(event.loaded, total);
      onProgress?.({
        loaded,
        total,
        percentage: total > 0 ? Math.min(100, (loaded / total) * 100) : 0,
      });
    });

    request.addEventListener("load", () => {
      let data: T | null = null;
      try {
        data = JSON.parse(request.responseText) as T;
      } catch {
        data = null;
      }
      resolve({
        status: request.status,
        ok: request.status >= 200 && request.status < 300,
        data,
      });
    });

    request.addEventListener("error", () => {
      reject(new Error("The upload could not reach the server. Check your connection and try again."));
    });
    request.addEventListener("timeout", () => {
      reject(new Error("The upload timed out. Check your connection and try again."));
    });
    request.addEventListener("abort", () => {
      reject(new Error("The upload was cancelled."));
    });

    request.send(formData);
  });
}
