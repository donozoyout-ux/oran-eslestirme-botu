import type { GoogleSheetsMirror } from "./google-sheets-mirror.js";

type RequestFunction = <T = unknown>(url: string, token: string, init?: RequestInit) => Promise<T>;

interface PatchableMirror {
  request: RequestFunction;
}

interface BatchUpdateBody {
  data?: Array<{ range?: string; values?: unknown[][] }>;
}

function bodyText(body: BodyInit | null | undefined): string | null {
  return typeof body === "string" ? body : null;
}

function tailRangesFromBatchUpdate(body: BodyInit | null | undefined): string[] {
  const text = bodyText(body);
  if (!text) return [];

  try {
    const parsed = JSON.parse(text) as BatchUpdateBody;
    const ranges: string[] = [];
    for (const entry of parsed.data ?? []) {
      if (!entry.range || !Array.isArray(entry.values)) continue;
      const match = entry.range.match(/^(.+)!A1$/);
      if (!match) continue;
      const sheet = match[1]!;
      const nextRow = Math.max(entry.values.length + 1, 2);
      ranges.push(`${sheet}!A${nextRow}:Z`);
    }
    return ranges;
  } catch {
    return [];
  }
}

/**
 * GoogleSheetsMirror normalde once A:Z alanini temizleyip sonra yeni veriyi yazar.
 * Ikinci istek hata verirse kullanicinin tablosu tamamen bos kalir.
 *
 * Bu yama batchClear'i erteler: once batchUpdate basariyla yeni veriyi yazar,
 * sonra yalnizca yeni tablonun altinda kalan eski satirlar temizlenir. Boylece
 * OAuth/API/timeout hatasi yeni yazmayi engellese bile mevcut Sheet korunur.
 */
export function enableSafeGoogleSheetRefresh(mirror: GoogleSheetsMirror): GoogleSheetsMirror {
  const target = mirror as unknown as PatchableMirror;
  const originalRequest = target.request.bind(mirror);
  let deferredClear: { url: string; token: string; init: RequestInit } | null = null;

  target.request = async <T = unknown>(url: string, token: string, init: RequestInit = {}): Promise<T> => {
    if (url.endsWith("/values:batchClear")) {
      deferredClear = { url, token, init: { ...init } };
      return {} as T;
    }

    if (url.endsWith("/values:batchUpdate") && deferredClear) {
      try {
        const result = await originalRequest<T>(url, token, init);
        const tailRanges = tailRangesFromBatchUpdate(init.body);
        if (tailRanges.length > 0) {
          await originalRequest(deferredClear.url, deferredClear.token, {
            ...deferredClear.init,
            method: "POST",
            body: JSON.stringify({ ranges: tailRanges }),
          });
        }
        return result;
      } finally {
        deferredClear = null;
      }
    }

    return originalRequest<T>(url, token, init);
  };

  return mirror;
}

export const googleSheetSafeRefreshInternals = { tailRangesFromBatchUpdate };
