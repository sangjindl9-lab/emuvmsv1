"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, options?: { method?: string; body?: unknown; formData?: FormData }): Promise<T> {
  const init: RequestInit = { method: options?.method ?? "GET", credentials: "same-origin" };
  if (options?.formData) {
    init.body = options.formData;
  } else if (options?.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(`/api/v1/${path}`, init);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : `요청 실패 (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export async function download(path: string, body: unknown, fileName?: string): Promise<void> {
  const response = await fetch(`/api/v1/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiError(response.status, text);
  }
  const blob = await response.blob();
  const url =URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName ?? "eumbms-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadGet(path: string, fileName?: string): Promise<void> {
  const response = await fetch(`/api/v1/${path}`, { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName ?? "eumbms-export.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function useApi<T>(path: string | null, options?: { pollMs?: number; deps?: unknown[] }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setLoading(true);
      const result = await api<T>(path);
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) setError((err as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...(options?.deps ?? [])]);

  useEffect(() => {
    if (!options?.pollMs || !path) return;
    const timer = setInterval(() => {
      void api<T>(path)
        .then((result) => {
          if (mounted.current) {
            setData(result);
            setError(null);
          }
        })
        .catch((err) => {
          if (mounted.current) setError((err as Error).message);
        });
    }, options.pollMs);
    return () => clearInterval(timer);
  }, [path, options?.pollMs]);

  return { data, error, loading, reload, setData };
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(value);
}
