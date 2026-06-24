"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Proposal } from "@/lib/types";
import { sendChat } from "@/lib/chatClient";
import { loadPdf, extractDocText, renderPageJpeg } from "@/lib/pdf";
import {
  CloseIcon,
  SendIcon,
  PaperclipIcon,
  SparkIcon,
  CheckIcon,
  GavelIcon,
  ChatIcon,
} from "./Icons";

export interface ChatScope {
  title: string;
  /** human-readable data context (pay items, codes, descriptions, notes) */
  contextText: string;
  /** the contested split's page images (jpeg dataURLs), sent once */
  scopeImages?: string[];
  /** pay items / material codes this conversation can write back to */
  refs: string[];
  /** is this a per-split challenge (vs. general Q&A) */
  challenge?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  scope: ChatScope | null;
  seed?: string;
  onApplyProposal: (p: Proposal) => Promise<void>;
}

interface Attachment {
  name: string;
  text: string;
  images: string[];
  sent: boolean;
}

interface Turn {
  msg: ChatMessage;
  proposals?: Proposal[];
  applied?: Set<number>;
}

export default function ChatPanel({ open, onClose, scope, seed, onApplyProposal }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [scopeSent, setScopeSent] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset when the scope changes (opening a different challenge / general chat).
  // Keyed on title + refs so two files with the same name don't share a thread.
  const scopeKey = `${scope?.title ?? ""}::${scope?.refs?.join("|") ?? ""}`;
  useEffect(() => {
    setTurns([]);
    setAttachments([]);
    setScopeSent(false);
    setError("");
    setInput(seed ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, seed]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  async function addFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) {
      if (f.type !== "application/pdf") continue;
      try {
        const buf = await f.arrayBuffer();
        const { doc, numPages } = await loadPdf(buf);
        const text = await extractDocText(doc, 16000);
        const images: string[] = [];
        if (text.replace(/\[p\d+\]/g, "").trim().length < 40) {
          // image-only reference — render the first couple of pages instead
          for (let p = 1; p <= Math.min(2, numPages); p++) {
            images.push(await renderPageJpeg(doc, p, 1100, 0.6));
          }
        }
        setAttachments((a) => [...a, { name: f.name, text, images, sent: false }]);
      } catch {
        /* skip unreadable */
      }
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || !scope) return;
    setError("");
    const userTurn: Turn = { msg: { role: "user", content: text } };
    const history = [...turns, userTurn];
    setTurns(history);
    setInput("");
    setSending(true);

    // Assemble context + images (scope images + unsent attachment images sent once).
    const unsentAttach = attachments.filter((a) => !a.sent);
    const attachText = attachments
      .map((a) => `Reference document "${a.name}" (for reasoning only, not part of the contested file):\n${a.text}`)
      .join("\n\n");
    const contextText = [scope.contextText, attachText].filter(Boolean).join("\n\n---\n\n");

    const images: string[] = [];
    if (!scopeSent && scope.scopeImages?.length) images.push(...scope.scopeImages);
    for (const a of unsentAttach) images.push(...a.images);

    const resp = await sendChat({
      messages: history.map((t) => t.msg),
      contextText,
      images,
    });

    setScopeSent(true);
    setAttachments((a) => a.map((x) => ({ ...x, sent: true })));

    if (resp.error) {
      setError(resp.error);
      setTurns((t) => [...t, { msg: { role: "assistant", content: "I hit an error reaching the API." } }]);
    } else {
      setTurns((t) => [
        ...t,
        { msg: { role: "assistant", content: resp.text || "(no response)" }, proposals: resp.proposals, applied: new Set() },
      ]);
    }
    setSending(false);
  }

  async function apply(turnIdx: number, propIdx: number, p: Proposal) {
    await onApplyProposal(p);
    setTurns((ts) =>
      ts.map((t, i) => {
        if (i !== turnIdx) return t;
        const applied = new Set(t.applied);
        applied.add(propIdx);
        return { ...t, applied };
      })
    );
  }

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-float transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* header */}
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${scope?.challenge ? "bg-amber-100 text-amber-700" : "bg-brand-100 text-brand-700"}`}>
            {scope?.challenge ? <GavelIcon width={17} height={17} /> : <ChatIcon width={17} height={17} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">
              {scope?.challenge ? "Challenge split" : "Ask Claude"}
            </div>
            {scope?.title && <div className="truncate text-xs text-ink-faint">{scope.title}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {turns.length === 0 && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm text-ink-faint">
              {scope?.challenge ? (
                <>
                  Ask whether this split is right. Claude reads the actual cert pages in this file
                  {scope.scopeImages?.length ? ` (${scope.scopeImages.length} pages)` : ""}. Attach reference
                  PDFs for extra context — they’re used only for reasoning and never added to the file.
                </>
              ) : (
                <>Ask about any pay item, material code, or certification. Attach reference PDFs to help.</>
              )}
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={t.msg.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                  t.msg.role === "user"
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-ink"
                }`}
              >
                {t.msg.content}
                {t.proposals && t.proposals.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {t.proposals.map((p, pi) => (
                      <div key={pi} className="rounded-xl border border-brand-200 bg-white p-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-700">
                          <SparkIcon width={13} height={13} />
                          {p.type === "crosswalk"
                            ? `${p.pay_item} → ${p.material_code ?? "(none)"}`
                            : `Remember about ${p.ref}`}
                        </div>
                        {(p.rationale || p.note) && (
                          <p className="mt-1 text-xs text-ink-soft">{p.rationale || p.note}</p>
                        )}
                        {t.applied?.has(pi) ? (
                          <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                            <CheckIcon width={13} height={13} /> Saved & remembered
                          </div>
                        ) : (
                          <button
                            onClick={() => apply(i, pi, p)}
                            className="mt-2 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                          >
                            Confirm &amp; remember
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-slate-100 px-4 py-3">
                <div className="flex gap-1">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
                </div>
              </div>
            </div>
          )}
          {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>}
        </div>

        {/* attachments + input */}
        <div className="border-t border-slate-200 p-3">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span key={i} className="chip bg-slate-100 text-ink-soft">
                  <PaperclipIcon width={11} height={11} /> {a.name}
                  {a.images.length > 0 && <span className="text-ink-faint">(scan)</span>}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <button
              onClick={() => fileRef.current?.click()}
              title="Attach reference PDF (reasoning only)"
              className="shrink-0 rounded-xl border border-slate-200 p-2.5 text-ink-faint hover:bg-slate-50"
            >
              <PaperclipIcon width={18} height={18} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={scope?.challenge ? "Why might this split be wrong?" : "Ask a question…"}
              className="max-h-32 flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-400"
            />
            <button onClick={send} disabled={!input.trim() || sending} className="btn-primary shrink-0 px-3 py-2.5">
              <SendIcon width={18} height={18} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
