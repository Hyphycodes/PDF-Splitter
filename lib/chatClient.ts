import { getApiKey } from "./vision";
import type { ChatMessage, Proposal } from "./types";

let serverKeyCache: boolean | null = null;

/** Does the deployment already have an Anthropic key linked? Cached per session. */
export async function hasServerKey(): Promise<boolean> {
  if (serverKeyCache !== null) return serverKeyCache;
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    serverKeyCache = !!data.hasServerKey;
  } catch {
    serverKeyCache = false;
  }
  return serverKeyCache;
}

export interface ChatResponse {
  text: string;
  proposals: Proposal[];
  error?: string;
}

export async function sendChat(args: {
  messages: ChatMessage[];
  contextText?: string;
  images?: string[];
}): Promise<ChatResponse> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, apiKey: getApiKey() }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { text: "", proposals: [], error: data?.detail || data?.error || "Request failed." };
    }
    return { text: data.text || "", proposals: (data.proposals as Proposal[]) || [] };
  } catch (e) {
    return { text: "", proposals: [], error: String(e) };
  }
}
