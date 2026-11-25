import type { ExtractionResult } from '../types';

const DB_NAME = 'clipcut_studio_vault_v2';
const STORE_NAME = 'extractions';
const MP4_STORE_NAME = 'rendered_mp4s';
const DB_VERSION = 2;
const FALLBACK_KEY = 'clipcut_studio_history_v1';

export interface SavedMp4Clip {
  key: string; // `${videoId}::${clipId}`
  videoId: string;
  clipId: string;
  clipNumber: number;
  title: string;
  filename: string;
  durationSeconds: number;
  sizeBytes: number;
  blob: Blob;
  savedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'video.videoId' });
      }
      if (!db.objectStoreNames.contains(MP4_STORE_NAME)) {
        const mp4Store = db.createObjectStore(MP4_STORE_NAME, {
          keyPath: 'key',
        });
        mp4Store.createIndex('by_videoId', 'videoId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function saveExtractionToStorage(
  item: ExtractionResult
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    try {
      const existing = JSON.parse(
        localStorage.getItem(FALLBACK_KEY) || '[]'
      ) as ExtractionResult[];
      const next = [
        item,
        ...existing.filter((x) => x.video.videoId !== item.video.videoId),
      ].slice(0, 10);
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
}

export async function getAllSavedExtractions(): Promise<ExtractionResult[]> {
  try {
    const db = await openDb();
    const items = await new Promise<ExtractionResult[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as ExtractionResult[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort(
      (a, b) =>
        new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime()
    );
  } catch {
    try {
      return JSON.parse(
        localStorage.getItem(FALLBACK_KEY) || '[]'
      ) as ExtractionResult[];
    } catch {
      return [];
    }
  }
}

export async function deleteSavedExtraction(videoId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, MP4_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).delete(videoId);
      const mp4Store = tx.objectStore(MP4_STORE_NAME);
      const index = mp4Store.index('by_videoId');
      const cursorReq = index.openCursor(IDBKeyRange.only(videoId));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    try {
      const existing = JSON.parse(
        localStorage.getItem(FALLBACK_KEY) || '[]'
      ) as ExtractionResult[];
      localStorage.setItem(
        FALLBACK_KEY,
        JSON.stringify(existing.filter((x) => x.video.videoId !== videoId))
      );
    } catch {
      // Ignore
    }
  }
}

export async function clearAllSavedExtractions(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_NAME, MP4_STORE_NAME], 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.objectStore(MP4_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    localStorage.removeItem(FALLBACK_KEY);
  }
}

export async function saveRenderedMp4Clip(clip: SavedMp4Clip): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(MP4_STORE_NAME, 'readwrite');
    tx.objectStore(MP4_STORE_NAME).put(clip);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getAllSavedMp4Clips(): Promise<SavedMp4Clip[]> {
  try {
    const db = await openDb();
    const items = await new Promise<SavedMp4Clip[]>((resolve, reject) => {
      const tx = db.transaction(MP4_STORE_NAME, 'readonly');
      const req = tx.objectStore(MP4_STORE_NAME).getAll();
      req.onsuccess = () => resolve((req.result as SavedMp4Clip[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return items.sort((a, b) => a.clipNumber - b.clipNumber);
  } catch {
    return [];
  }
}
