import { openDB, type IDBPDatabase } from "idb";
import type { MaterialMaster, PayItemCrosswalk } from "./types";
import { MATERIAL_MASTER_SEED } from "./material-master-seed";
import { CROSSWALK_SEED } from "./crosswalk-seed";

const DB_NAME = "cert-splitter";
const DB_VERSION = 1;

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
