// Client helpers for the one place an API earns its keep: image-only cert pages
// (OCR the stamped pay-item box) and research-mode verification. Only a single
// page image is ever sent — never the whole packet.

export function getApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("anthropic_api_key") || "";
}

export function setApiKey(key: string) {
  if (typeof window === "undefined") return;
  if (key) window.localStorage.setItem("anthropic_api_key", key);
  else window.localStorage.removeItem("anthropic_api_key");
}

/** Read pay-item number(s) off a scanned page image. Returns [] on any failure. */
export async function ocrPayItems(pngDataUrl: string): Promise<string[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];
  try {
    const res = await fetch("/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "ocr", apiKey, image: pngDataUrl }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.payItems) ? data.payItems : [];
  } catch {
    return [];
  }
}
