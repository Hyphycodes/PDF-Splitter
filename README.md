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
5. **Group by the pay-item box** — pages that carry the **same set of pay items**
   belong to the same cert and go into **one** output file. This covers multi-page
   certs (the box repeats on each page) and certs whose box lists several pay items
   at once — every one of those pay items is named in the file and listed at the top.
   Pay-item boxes are often rotated/sideways; Claude reads pages in any orientation
   when the local text layer misses the box.
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

### Reading: local first, Claude only when needed (no toggle)

There's no "use Claude" switch. The tool reads the text layer locally first; it
escalates to Claude **automatically** only when a page needs more power:

- **Cover sheet** — parsed locally; if the local read isn't trustworthy (no text
  layer, missing quantities, no clear quantity column), Claude reads the cover image
  to get accurate quantities, the contract, and the inspector's stamped date.
- **Cert pages** — text-layer pages read locally; image-only/scanned pages are OCR'd
  by Claude automatically.

If no API key is linked, everything still runs on the local text layer (with a
warning that messy/scanned packets may be incomplete).

### Research mode (real research, with web search)

When **Research** is on, after the split Claude works each material group and
**cross-checks three sources**, flagging any disagreement:

1. what the **pay-item description** says (e.g. `2C` = 2 conductors),
2. what the **uploaded cert** actually states, and
3. what the **manufacturer's datasheet** says — found live via **web search**
   (Service Wire, Advanced Digital Cable, Southwire, …).

If the description says `2C` but the datasheet shows a single conductor, that's a
**mismatch** and it's flagged with the likely-correct code (one click to apply +
remember). Datasheets it finds can be **saved into a local reference library**
(downloaded via a proxy) for future reference — reference-only, never merged into an
output file. You can also **Discuss the findings with Claude right away** (not only
save them). `confirmed` crosswalk rows stay authoritative.

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
  acceptance). Click any code to copy. Reachable from the top nav at any time.
- **History tab** — every split is saved locally as one **inspection** (project +
  date + the original packet PDF, all in IndexedDB). Reopen any inspection to
  re-view the files, quantities, and matches; edits you confirm are written back to
  that record. Nothing leaves the machine.
- **Saving is automatic and visible** — name the project inline in the review header
  (defaults to `contract_date`); a **Saving… / Saved** badge shows the state. The
  same name is used for the download folder.
- **Challenge a split (the only chat)** — chat is scoped to one output file. Each
  generated file has a **Challenge** button that opens a chat box specific to the
  pay items / materials in that file. It sends Claude the *actual cert pages in that
  file* (rendered images) plus any **reference PDFs you attach** (more certs you
  found online, etc.) — attachments are **prompt context only** and are never added
  to the file you’re contesting.
- **Confirm & remember** — when Claude proposes a fix (a material-code change or a
  note), you confirm it. The crosswalk row is upgraded to `confirmed` and a research
  note is stored, so the next time that cert / pay item / material code shows up,
  the tool already knows. This is the learning loop.
- **Assign uncategorized pages** — pages that didn’t match a pay item appear in an
  "uncategorized" list; assign each to any file (or start a new file from it) with a
  dropdown.
- **Download all** — one click packs every file into `project_date.zip`, whose
  contents sit inside a single `project_date/` folder. Per-file download is also
  available.

## Review UI

- **File list** — one card per output PDF: name, the material code / pay items it
  covers, page count, and a pending/confirmed status.
- **Inline PDF viewer** — flip through each generated file in-app (cover on top,
  matched certs underneath); no download required to verify.
- **Full-page preview** — click any page (assigned or uncategorized) to see it
  full-size in a lightbox, and assign it from there.
- **Add / edit pages** — each file has an "Add / edit pages" picker showing every
  page; check the ones that belong. Adding a page **moves** it here and removes it
  from any other file it was wrongly in.
- **Uncategorized pages** — pages that matched no pay item are listed for easy
  assignment to any file (or a new one).
- **Rename inline** — edit the filename directly.
- **Project + date bar** — edit the project number and date once at the top; the
  change applies to **every** file's name.
- **Editable pay-item list** — add or remove pay items on a file (add picks from the
  cover list and updates the filename); each pay item is used once per file.
- **Material code is always populated** and editable per row via a dropdown.
- **Missing-cert awareness** — the tool knows every pay item on the cover, so it
  flags pay items with no cert pages yet and lets you assign a stray page to one of
  them instead of making a new file.
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

Models: cover-reading / OCR, chat / challenge, and research all use
`claude-opus-4-8`. Research and challenges use Anthropic's server-side **web
search** tool to find manufacturer datasheets.

---

## Notes & limits

- Cover-sheet layouts vary, so quantity/description extraction is best-effort and
  **everything is editable** in the review screen before you confirm.
- Matching itself is exact on the pay-item number — the heuristics only affect what
  gets pre-filled, never correctness of the split once a number is read correctly.
