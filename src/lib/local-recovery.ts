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
  focusTarget: "title" | "subject" | "editor" | "tags" | null;
  savedAt: number;
  serverUpdatedAt: number | null;
};

export type LocalNoteRevision = {
  version: 1;
  noteId: string;
  topicId: string;
  title: string;
  subject: string;
  tagsInput: string;
  pinned: boolean;
  content: unknown;
  savedAt: number;
};

type EncryptedDraftRecord = {
  id: string;
  // Existing v1 records used number arrays; new writes use compact typed arrays.
  iv: Uint8Array | number[];
  ciphertext: Uint8Array | number[];
  updatedAt: number;
};

type EncryptedRevisionRecord = {
  id: string;
  noteId: string;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  updatedAt: number;
};

const DATABASE_NAME = "mnemosyne-local-recovery";
const DATABASE_VERSION = 2;
const DRAFT_STORE = "drafts";
const REVISION_STORE = "revisions";
const KEY_STORE = "keys";
const MAX_LOCAL_REVISIONS = 5;
const revisionWrites = new Map<string, Promise<void>>();
const DEVICE_KEY_ID = "local-draft-encryption-key";
const pendingWrites = new Map<string, Promise<void>>();
let recoveryDatabasePromise: Promise<IDBDatabase> | null = null;
let deviceKeyPromise: Promise<CryptoKey> | null = null;

function openRecoveryDatabase(): Promise<IDBDatabase> {
  if (recoveryDatabasePromise) return recoveryDatabasePromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
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
      if (!database.objectStoreNames.contains(REVISION_STORE)) {
        const revisions = database.createObjectStore(REVISION_STORE, { keyPath: "id" });
        revisions.createIndex("noteId", "noteId", { unique: false });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
        recoveryDatabasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open local recovery storage."));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Local recovery storage is blocked by another browser tab."));
    };
  }).catch((error) => {
    recoveryDatabasePromise = null;
    throw error;
  });

  recoveryDatabasePromise = opening;
  return opening;
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

async function getCachedDeviceKey(database: IDBDatabase): Promise<CryptoKey> {
  if (!deviceKeyPromise) {
    deviceKeyPromise = getDeviceKey(database).catch((error) => {
      deviceKeyPromise = null;
      throw error;
    });
  }
  return deviceKeyPromise;
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
      const key = await getCachedDeviceKey(database);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const plaintext = new TextEncoder().encode(JSON.stringify(draft));
      const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
      const record: EncryptedDraftRecord = {
        id,
        iv,
        ciphertext: new Uint8Array(encrypted),
        updatedAt: draft.savedAt,
      };
      const transaction = database.transaction(DRAFT_STORE, "readwrite");
      transaction.objectStore(DRAFT_STORE).put(record);
      await transactionComplete(transaction);
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
  const transaction = database.transaction(DRAFT_STORE, "readonly");
  const request = transaction.objectStore(DRAFT_STORE).get(id);
  const record = await new Promise<EncryptedDraftRecord | null>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as EncryptedDraftRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Could not read the local note draft."));
  });
  await transactionComplete(transaction);
  if (!record) return null;

  const key = await getCachedDeviceKey(database);
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(record.iv) },
    key,
    new Uint8Array(record.ciphertext),
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as LocalNoteDraft;
  if (parsed.version !== 1 || typeof parsed.savedAt !== "number") return null;
  return parsed;
}

export function saveLocalNoteRevision(noteId: string, revision: LocalNoteRevision): Promise<void> {
  const previous = revisionWrites.get(noteId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const database = await openRecoveryDatabase();
    const key = await getCachedDeviceKey(database);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(revision));
    const encrypted = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    const record: EncryptedRevisionRecord = {
      id: `${noteId}:${revision.savedAt}:${window.crypto.randomUUID()}`,
      noteId,
      iv,
      ciphertext: new Uint8Array(encrypted),
      updatedAt: revision.savedAt,
    };

    const transaction = database.transaction(REVISION_STORE, "readwrite");
    transaction.objectStore(REVISION_STORE).put(record);
    await transactionComplete(transaction);

    const readTransaction = database.transaction(REVISION_STORE, "readonly");
    const index = readTransaction.objectStore(REVISION_STORE).index("noteId");
    const request = index.getAll(noteId);
    const records = await new Promise<EncryptedRevisionRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as EncryptedRevisionRecord[]) ?? []);
      request.onerror = () => reject(request.error ?? new Error("Could not list local revisions."));
    });
    await transactionComplete(readTransaction);

    const stale = records.sort((a, b) => b.updatedAt - a.updatedAt).slice(MAX_LOCAL_REVISIONS);
    if (stale.length) {
      const prune = database.transaction(REVISION_STORE, "readwrite");
      for (const item of stale) prune.objectStore(REVISION_STORE).delete(item.id);
      await transactionComplete(prune);
    }
  });
  revisionWrites.set(noteId, current);
  return current.finally(() => {
    if (revisionWrites.get(noteId) === current) revisionWrites.delete(noteId);
  });
}

export async function loadLocalNoteRevisions(noteId: string): Promise<LocalNoteRevision[]> {
  const pending = revisionWrites.get(noteId);
  if (pending) await pending.catch(() => undefined);
  const database = await openRecoveryDatabase();
  const transaction = database.transaction(REVISION_STORE, "readonly");
  const request = transaction.objectStore(REVISION_STORE).index("noteId").getAll(noteId);
  const records = await new Promise<EncryptedRevisionRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as EncryptedRevisionRecord[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Could not read local revisions."));
  });
  await transactionComplete(transaction);
  const key = await getCachedDeviceKey(database);
  const revisions: LocalNoteRevision[] = [];
  for (const record of records.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_LOCAL_REVISIONS)) {
    try {
      const plaintext = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(record.iv) },
        key,
        new Uint8Array(record.ciphertext),
      );
      const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as LocalNoteRevision;
      if (parsed.version === 1 && parsed.noteId === noteId && typeof parsed.savedAt === "number") {
        revisions.push(parsed);
      }
    } catch {
      // Ignore a damaged local snapshot; other revisions remain usable.
    }
  }
  return revisions;
}

export async function removeLocalNoteRevisions(noteId: string): Promise<void> {
  const pending = revisionWrites.get(noteId);
  if (pending) await pending.catch(() => undefined);
  const database = await openRecoveryDatabase();
  const transaction = database.transaction(REVISION_STORE, "readwrite");
  const store = transaction.objectStore(REVISION_STORE);
  const request = store.index("noteId").getAllKeys(noteId);
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as IDBValidKey[]) ?? []);
    request.onerror = () => reject(request.error ?? new Error("Could not list local revisions."));
  });
  for (const key of keys) store.delete(key);
  await transactionComplete(transaction);
}

export async function removeLocalNoteDraft(id: string): Promise<void> {
  const pending = pendingWrites.get(id);
  if (pending) await pending.catch(() => undefined);
  const database = await openRecoveryDatabase();
  const transaction = database.transaction(DRAFT_STORE, "readwrite");
  transaction.objectStore(DRAFT_STORE).delete(id);
  await transactionComplete(transaction);
}

export async function flushPendingLocalDraftWrites(): Promise<void> {
  await Promise.all(Array.from(pendingWrites.values()).map((write) => write.catch(() => undefined)));
}
