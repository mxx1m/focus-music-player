// Storage (IndexedDB "focus-player")
//   tracks: the audio files, one record per item ({ id, blob, type }; older records also carry metadata)
//   items:  metadata per track or episode ({ id, name, section, labelId, order, duration, size, type, added, position, played })
//   labels: groups per section ({ id, name, section, order, builtin })
// Version 1 only had "tracks". Version 2 adds "items" and "labels"; app.js fills them from the old records on first start.

const DB_NAME = 'focus-player';
const VERSION = 2;
let dbp = null;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, VERSION); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('labels')) db.createObjectStore('labels', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close(); // let a newer version of the app upgrade
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => { const e = new Error('blocked'); e.name = 'BlockedError'; reject(e); };
  });
  return dbp;
}

function done(t) {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}
function result(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

/** Everything needed at start: metadata, labels, and the file records (Blobs are file-backed handles, so this stays light). */
export async function loadAll() {
  const db = await openDB();
  const t = db.transaction(['tracks', 'items', 'labels'], 'readonly');
  const [files, items, labels] = await Promise.all([
    result(t.objectStore('tracks').getAll()),
    result(t.objectStore('items').getAll()),
    result(t.objectStore('labels').getAll())
  ]);
  return { files, items, labels };
}

/** Save a new file and its metadata together. */
export async function addItem(item, file) {
  const db = await openDB();
  const write = (blob) => {
    const t = db.transaction(['tracks', 'items'], 'readwrite');
    t.objectStore('tracks').put({ id: item.id, blob, type: item.type });
    t.objectStore('items').put(item);
    return done(t);
  };
  try {
    await write(new Blob([file], { type: item.type }));
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') throw err;
    // Some Safari versions refuse to store Blobs; fall back to raw bytes.
    await write(await file.arrayBuffer());
  }
}

export async function putItems(items) {
  if (!items.length) return;
  const db = await openDB();
  const t = db.transaction('items', 'readwrite');
  const s = t.objectStore('items');
  items.forEach(i => s.put(i));
  return done(t);
}

export async function putLabels(labels) {
  if (!labels.length) return;
  const db = await openDB();
  const t = db.transaction('labels', 'readwrite');
  const s = t.objectStore('labels');
  labels.forEach(l => s.put(l));
  return done(t);
}

export async function deleteItems(ids) {
  const db = await openDB();
  const t = db.transaction(['tracks', 'items'], 'readwrite');
  ids.forEach(id => { t.objectStore('tracks').delete(id); t.objectStore('items').delete(id); });
  return done(t);
}

export async function deleteLabel(id) {
  const db = await openDB();
  const t = db.transaction('labels', 'readwrite');
  t.objectStore('labels').delete(id);
  return done(t);
}
