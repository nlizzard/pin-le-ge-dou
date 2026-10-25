// Former names are used only to import existing users' local data.
export function migrateLocalStorage(storage: Storage): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter((key): key is string => key !== null && key.startsWith('picture-play-'));
  for (const oldKey of keys) {
    const newKey = oldKey.replace('picture-play-', 'pin-le-ge-dou-');
    const value = storage.getItem(oldKey);
    if (value !== null && storage.getItem(newKey) === null) storage.setItem(newKey, value);
    storage.removeItem(oldKey);
  }
}

try {
  migrateLocalStorage(localStorage);
} catch {
  // Storage can be unavailable or full; unconverted entries remain for retry.
}

export async function migrateGallery(db: IDBDatabase): Promise<void> {
  const marker = '__brandMigration';
  const request = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (await request(db.transaction('settings').objectStore('settings').get(marker))) return;
  const legacy = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const req = indexedDB.open('picture-play-gallery');
    let absent = false;
    req.onupgradeneeded = () => { absent = true; req.transaction!.abort(); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => absent ? resolve(null) : reject(req.error);
    req.onblocked = () => reject(new Error('请关闭旧版页面后重试缓存迁移'));
  });
  const rows: { store: string; key: IDBValidKey; value: unknown }[] = [];
  if (legacy) {
    try {
      for (const store of ['works', 'settings']) {
        if (!legacy.objectStoreNames.contains(store)) continue;
        const os = legacy.transaction(store).objectStore(store);
        const [keys, values] = await Promise.all([request(os.getAllKeys()), request(os.getAll())]);
        keys.forEach((key, i) => rows.push({ store, key, value: values[i] }));
      }
    } finally { legacy.close(); }
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['works', 'settings'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
    for (const row of rows) {
      const os = tx.objectStore(row.store);
      const existing = os.get(row.key);
      existing.onsuccess = () => {
        if (existing.result === undefined) {
          if (os.keyPath) os.put(row.value);
          else os.put(row.value, row.key);
        }
      };
    }
    tx.objectStore('settings').put(true, marker);
  });
}
