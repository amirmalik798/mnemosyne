"use client";

export type LocalNoteDraft = {
  version: 1;
  noteId: string | null;
  topicId: string;
  title: string;
  subject: string;
  tagsInput: string;
  pinned: boolean;
  content: unknown;
  selection: { from: number; to: number };
  savedAt: number;
  serverUpdatedAt: number | null;
};

type EncryptedDraftRecord = {
  id: string;
  iv: number[];
  ciphertext: number[];
  updatedAt: number;
};

const DATABASE_NAME = "mnemosyne-local-recovery";
const DATABASE_VERSION = 1;
const DRAFT_STORE = "drafts";
const KEY_STORE = "keys";
const DEVICE_KEY_ID = "local-draft-encryption-key";
const pendingWrites = new Map<string, Promise<void>>();

function openRecoveryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("Local recovery storage is unavailable in this browser."));
      return;
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(KEY_STORE)) {
        database.createObjectStore(KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local recovery storage."));
    request.onblocked = () => reject(new Error("Local recovery storage is blocked by another browser tab."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Local recovery transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local recovery transaction was interrupted."));
  });
}

async function readDeviceKey(database: IDBDatabase): Promise<CryptoKey | null> {
  const transaction = database.transaction(KEY_STORE, "readonly");
  const request = transaction.objectStore(KEY_STORE).get(DEVICE_KEY_ID);
  const key = await new Promise<CryptoKey | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read the local recovery key."));
  });
  await transactionComplete(transaction);
  return key;
}

async function getDeviceKey(database: IDBDatabase): Promise<CryptoKey> {
  const existing = await readDeviceKey(database);
  if (existing) return existing;

  const generated = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  try {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).add(generated, DEVICE_KEY_ID);
    await transactionComplete(transaction);
    return generated;
  } catch {
    // Another tab may have initialized the key at the same time.
    const key = await readDeviceKey(database);
    if (key) return key;
    throw new Error("Could not initialize the local recovery key.");
  }
}

export async function requestPersistentLocalStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function saveLocalNoteDraft(id: string, draft: LocalNoteDraft): Promise<void> {
  const previous = pendingWrites.get(id) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const database = await openRecoveryDatabase();
      try {
        const key = await getDeviceKey(database);
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const plaintext = new TextEncoder().encode(JSON.stringify(draft));
        const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
        const record: EncryptedDraftRecord = {
          id,
          iv: Array.from(iv),
          ciphertext: Array.from(new Uint8Array(encrypted)),
          updatedAt: draft.savedAt,
        };
        const transaction = database.transaction(DRAFT_STORE, "readwrite");
        transaction.objectStore(DRAFT_STORE).put(record);
        await transactionComplete(transaction);
      } finally {
        database.close();
      }
    });

  pendingWrites.set(id, current);
  return current.finally(() => {
    if (pendingWrites.get(id) === current) pendingWrites.delete(id);
  });
}

export async function loadLocalNoteDraft(id: string): Promise<LocalNoteDraft | null> {
  const pending = pendingWrites.get(id);
  if (pending) await pending.catch(() => undefined);

  const database = await openRecoveryDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, "readonly");
    const request = transaction.objectStore(DRAFT_STORE).get(id);
    const record = await new Promise<EncryptedDraftRecord | null>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as EncryptedDraftRecord | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the local note draft."));
    });
    await transactionComplete(transaction);
    if (!record) return null;

    const key = await getDeviceKey(database);
    const plaintext = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      key,
      new Uint8Array(record.ciphertext),
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as LocalNoteDraft;
    if (parsed.version !== 1 || typeof parsed.savedAt !== "number") return null;
    return parsed;
  } finally {
    database.close();
  }
}

export async function removeLocalNoteDraft(id: string): Promise<void> {
  const pending = pendingWrites.get(id);
  if (pending) await pending.catch(() => undefined);
  const database = await openRecoveryDatabase();
  try {
    const transaction = database.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).delete(id);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function flushPendingLocalDraftWrites(): Promise<void> {
  await Promise.all(Array.from(pendingWrites.values()).map((write) => write.catch(() => undefined)));
}
