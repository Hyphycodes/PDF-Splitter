import { openDB, type IDBPDatabase } from "idb";
import type {
  MaterialMaster,
  PayItemCrosswalk,
  Inspection,
  ResearchNote,
} from "./types";
import { MATERIAL_MASTER_SEED } from "./material-master-seed";
import { CROSSWALK_SEED } from "./crosswalk-seed";

const DB_NAME = "cert-splitter";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("material_master")) {
          db.createObjectStore("material_master", { keyPath: "material_code" });
        }
        if (!db.objectStoreNames.contains("payitem_crosswalk")) {
          db.createObjectStore("payitem_crosswalk", { keyPath: "pay_item" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("inspections")) {
          const store = db.createObjectStore("inspections", { keyPath: "id" });
          store.createIndex("updated_at", "updated_at");
        }
        if (!db.objectStoreNames.contains("research_notes")) {
          db.createObjectStore("research_notes", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

/** Seed both tables on first run. Idempotent. */
export async function ensureSeeded(): Promise<void> {
  const db = await getDB();
  const seeded = await db.get("meta", "seeded");
  if (seeded) return;

  const tx = db.transaction(["material_master", "payitem_crosswalk", "meta"], "readwrite");
  for (const m of MATERIAL_MASTER_SEED) await tx.objectStore("material_master").put(m);
  for (const c of CROSSWALK_SEED) {
    await tx.objectStore("payitem_crosswalk").put({ ...c, updated_at: 0 });
  }
  await tx.objectStore("meta").put({ key: "seeded", value: true });
  await tx.done;
}

export async function getAllMaterials(): Promise<MaterialMaster[]> {
  const db = await getDB();
  const rows = (await db.getAll("material_master")) as MaterialMaster[];
  return rows.sort((a, b) => a.material_code.localeCompare(b.material_code));
}

export async function getMaterial(code: string | null): Promise<MaterialMaster | undefined> {
  if (!code) return undefined;
  const db = await getDB();
  return db.get("material_master", code) as Promise<MaterialMaster | undefined>;
}

export async function getAllCrosswalk(): Promise<PayItemCrosswalk[]> {
  const db = await getDB();
  const rows = (await db.getAll("payitem_crosswalk")) as PayItemCrosswalk[];
  return rows.sort((a, b) => a.pay_item.localeCompare(b.pay_item));
}

export async function getCrosswalk(payItem: string): Promise<PayItemCrosswalk | undefined> {
  const db = await getDB();
  return db.get("payitem_crosswalk", payItem) as Promise<PayItemCrosswalk | undefined>;
}

/** Upsert a crosswalk row (e.g. when the inspector confirms or corrects a suggestion). */
export async function upsertCrosswalk(row: PayItemCrosswalk): Promise<void> {
  const db = await getDB();
  await db.put("payitem_crosswalk", { ...row, updated_at: Date.now() });
}

export async function getCrosswalkMap(): Promise<Map<string, PayItemCrosswalk>> {
  const rows = await getAllCrosswalk();
  return new Map(rows.map((r) => [r.pay_item, r]));
}

export async function getMaterialMap(): Promise<Map<string, MaterialMaster>> {
  const rows = await getAllMaterials();
  return new Map(rows.map((r) => [r.material_code, r]));
}

// ---- Inspections (saved runs) ---------------------------------------------

export async function saveInspection(insp: Inspection): Promise<void> {
  const db = await getDB();
  await db.put("inspections", insp);
}

export async function getAllInspections(): Promise<Inspection[]> {
  const db = await getDB();
  const rows = (await db.getAll("inspections")) as Inspection[];
  return rows.sort((a, b) => b.updated_at - a.updated_at);
}

export async function getInspection(id: string): Promise<Inspection | undefined> {
  const db = await getDB();
  return db.get("inspections", id) as Promise<Inspection | undefined>;
}

export async function deleteInspection(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("inspections", id);
}

// ---- Research notes (memory that sharpens over time) -----------------------

export async function upsertResearchNote(note: ResearchNote): Promise<void> {
  const db = await getDB();
  await db.put("research_notes", { ...note, updated_at: Date.now() });
}

export async function getResearchNote(key: string): Promise<ResearchNote | undefined> {
  const db = await getDB();
  return db.get("research_notes", key) as Promise<ResearchNote | undefined>;
}

export async function getAllResearchNotes(): Promise<ResearchNote[]> {
  const db = await getDB();
  const rows = (await db.getAll("research_notes")) as ResearchNote[];
  return rows.sort((a, b) => b.updated_at - a.updated_at);
}

/** Pull notes relevant to a set of pay items / material codes for chat context. */
export async function getRelevantNotes(refs: string[]): Promise<ResearchNote[]> {
  const all = await getAllResearchNotes();
  const set = new Set(refs);
  return all.filter((n) => set.has(n.ref));
}

/** Wipe and re-seed — useful for development / "reset data". */
export async function resetDatabase(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["material_master", "payitem_crosswalk", "meta"], "readwrite");
  await tx.objectStore("material_master").clear();
  await tx.objectStore("payitem_crosswalk").clear();
  await tx.objectStore("meta").clear();
  await tx.done;
  await ensureSeeded();
}
