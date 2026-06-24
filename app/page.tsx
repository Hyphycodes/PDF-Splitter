"use client";

import dynamic from "next/dynamic";

// The app is fully client-side (pdf.js, pdf-lib, IndexedDB). Render it
// browser-only so nothing PDF-related is evaluated during SSR/prerender.
const AppShell = dynamic(() => import("@/components/AppShell"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center text-sm text-ink-faint">
      Loading…
    </div>
  ),
});

export default function Page() {
  return <AppShell />;
}
