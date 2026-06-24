# Cert Splitter — IDOT Electrical Materials

An internal inspector tool for IDOT electrical materials inspection. Drop in one
inspection packet (a **cover sheet / IL OKAY LOG** followed by 30–40 pages of
certs) and the tool builds **one clean PDF per material group** — cover sheet on
top, the matched cert pages underneath — auto-named and ready for the inspector
to verify, edit, and upload to CMMS.

It replaces the manual loop of *open packet → select the cover + the 2–3 cert
pages for a pay item → extract → rename → repeat ~20×*.

---

## How it works (the pipeline)

1. **Ingest** — drop in the full packet (single multi-page PDF).
2. **Read the cover sheet** — locally parse the text layer to pull every row:
   pay item #, description, quantity, UOM.
3. **Read each cert page** — find the stamped/boxed pay-item number(s). A cert may
   carry multiple pay items; a multi-page cert repeats the box on each page.
4. **Match** — a *deterministic exact match on the pay-item number*. `87301225`
   on a cert == `87301225` on the cover sheet, those pages belong together. The
   only unreliable step is reading the number off a messy scan; everything
   downstream of a correct read is exact.
5. **Group** — assign cert pages to material groups via the pay-item → material-code
   crosswalk. Pay items that share a material code collapse into **one** output file.
6. **Build output PDFs** — for each group: page 1 = the cover sheet, then the matched
   cert pages in order. The cover sheet is in **every** output file (the inspector
   needs it for the quantities).
7. **Auto-name** — `CONTRACT_DATE_PAYITEMS.pdf`
   (e.g. `62P93_062226_87301225.pdf`, or `…_87301225-87301245.pdf` when a group
   covers several pay items). The date is the inspector's initialed/stamped date
   read off the cover. Editable inline.
8. **Order** — output files follow the order the pay items appear on the cover list.
9. **Review** — nothing is final until the inspector confirms each file.

The cover sheet is read with Claude (the most capable model) for accurate
quantities, contract, and date; scanned/image-only cert pages are OCR'd the same
way. Clean text-layer cert pages are read locally. This all happens automatically —
no per-run toggling — whenever an Anthropic key is available.

---

## Local-first privacy model

Privacy is a real requirement — these packets carry mildly sensitive contract info.
The design keeps as much as possible on the inspector's machine.

| Step | Where it runs | Leaves the machine? |
| --- | --- | --- |
| Text-layer reading (cover + clean certs) | Browser (`pdf.js`) | **No** |
| Splitting / merging output PDFs | Browser (`pdf-lib`) | **No** |
| Master data (`material_master`, `payitem_crosswalk`) | Browser (IndexedDB) | **No** |
| OCR of **image-only** cert pages | Anthropic API (vision) | Only that single page image |
| Research-mode verification | Anthropic API | Only the page in question |

The PDF bytes never need to hit a server. The only calls that leave the machine
are single-page images for pages that have **no readable text layer** — and only
when OCR is switched on.

### How the Research toggle changes the data flow

- **OFF (fast, local-leaning):** read pay-item boxes, exact-match to cover-sheet
  rows, pull the material code straight from the crosswalk. Text-layer pages never
  leave the machine. Quick passes for clean packets.
- **ON (deeper):** sanity-check the assigned material code against what the cert
  *describes* and flag mismatches. The canonical example — the conductor-count
  rule: a description reading `… 3C` should map to `301x3`; if the crosswalk
  assigned `30102`, it's flagged. `confirmed` rows are authoritative and are
  **never** auto-flagged (e.g. CONC FDN → `31601` is correct: the ground rod is the
  certifiable component). Research targets `suggested` and `research`/NULL rows.

---

## The database

Two seed tables live in **IndexedDB** (privacy default; swap to Supabase only if
cross-device sync is wanted — note that moves master data to the cloud).

- **`material_master`** — `material_code` (PK), `description`, `group`, `uom`,
  `method_of_acceptance`, `spec_article`. Seeded from the *Manual for Materials
  Inspection (Electrical)* (groups 200 + 300).
- **`payitem_crosswalk`** — `pay_item` (PK), `pay_item_description`,
  `material_code` (FK), `confidence`, `source` (`seed` | `confirmed` |
  `suggested` | `research`). Seeded from the inspector's cover-sheet annotations
  (contract 62P93). It sharpens over time: every accept/correct in the review UI
  upgrades a row to `confirmed`.

Two more stores hold per-machine working data, also local-only:

- **`inspections`** — each saved run: project, date, the original packet PDF (Blob),
  and the reviewed result. Powers the History tab.
- **`research_notes`** — confirmed findings keyed by pay item / material code / cert,
  surfaced back to Claude as context so it sharpens over time.

Seeding is automatic on first load and idempotent.

### Re-importing the full material master

`lib/material-master-seed.ts` is generated from the manual PDF. Regenerate it with:

```bash
node scripts/import-master.mjs path/to/Manual_for_Materials_Inspection_Electrical.pdf
```

---

## Master reference, history & chat

- **Reference tab** — a searchable master database of every pay item (→ material
  code, description, source) and every material (code, description, group, UOM,
  acceptance). Click any code to copy. Reachable from the top nav at any time —
  before, during, or after a split. Each pay item has an **Ask** button that opens
  Claude with that item in context.
- **History tab** — every split is saved locally as one **inspection** (project +
  date + the original packet PDF, all in IndexedDB). Reopen any inspection to
  re-view the files, quantities, and matches; edits you confirm are written back to
  that record. Nothing leaves the machine.
- **Ask Claude** — a chat panel (top-right) for questions about any pay item,
  material code, or cert. Attach extra **reference PDFs** to help Claude reason;
  those attachments are used **only as prompt context** and are never added to any
  output file.
- **Challenge a split** — every generated file has a **Challenge** button. It sends
  Claude the *actual cert pages in that file* (rendered images) plus your reference
  attachments, and asks whether the material code and the included pages are right.
- **Confirm & remember** — when Claude proposes a fix (a material-code change or a
  note), you confirm it. The crosswalk row is upgraded to `confirmed` and a research
  note is stored, so the next time that cert / pay item / material code shows up,
  the tool already knows. This is the learning loop.

## Review UI

- **File list** — one card per output PDF: name, the material code / pay items it
  covers, page count, and a pending/confirmed status.
- **Inline PDF viewer** — flip through each generated file in-app (cover on top,
  matched certs underneath); no download required to verify.
- **Page reassignment** — pages that landed in the wrong group can be removed; any
  unassigned page can be added to the open file.
- **Rename inline** — edit the filename directly.
- **Copyable data table** — per pay item: quantity, material code, pay-item #,
  description. **Quantity is a prominent click-to-copy cell** (it's the field keyed
  into CMMS).
- **Crosswalk suggestions** — accept (→ `confirmed`) or correct (→ updates the
  crosswalk for next time).
- **Confirm / lock** per file, then **Export confirmed** / **Download all**.

---

## Stack

- **Next.js 14 + TypeScript + Tailwind**
- **pdf.js** — client-side text-layer extraction + page rendering
- **pdf-lib** — client-side split/merge to build output PDFs (stays local)
- **IndexedDB** (`idb`) — local DB; Supabase optional for sync
- **Anthropic API (vision)** — OCR fallback for image-only pages + research-mode
  verification only

---

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

```bash
npm run build && npm start   # production
```

### Anthropic API key

The OCR, chat, challenge, and research features call the Anthropic API. There are
two ways to supply a key:

- **Linked on the deployment (recommended):** set `ANTHROPIC_API_KEY` as an
  environment variable (e.g. in Vercel project settings). The app detects it via
  `/api/config` and just works — no key entry in the UI.
- **Per-browser:** if no server key is linked, turn on OCR and paste a key in the
  upload screen; it's stored only in your browser's localStorage.

Optional: `ANTHROPIC_BASE_URL` overrides the API base (defaults to
`https://api.anthropic.com`).

Models: chat / challenge / research use `claude-opus-4-8`; image-only OCR uses
`claude-sonnet-4-6`.

---

## Notes & limits

- Cover-sheet layouts vary, so quantity/description extraction is best-effort and
  **everything is editable** in the review screen before you confirm.
- Matching itself is exact on the pay-item number — the heuristics only affect what
  gets pre-filled, never correctness of the split once a number is read correctly.
