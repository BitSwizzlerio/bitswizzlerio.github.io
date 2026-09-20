/* Bank library: named banks saved in the browser (IndexedDB, with a localStorage fallback).
   The working bank keeps auto-saving to localStorage as before; this is the deliberate "Save / Load my banks" layer. */
window.Foley = window.Foley || {};
(function () {
  const DB = 'foley-library', STORE = 'banks', LS = 'foley.library.v1';
  let dbp = null;
  const openDb = () => {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no IndexedDB')); return; }
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' }); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error || new Error('IndexedDB open failed')); req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  };
  const tx = (mode, fn) => openDb().then(db => new Promise((resolve, reject) => { const t = db.transaction(STORE, mode); const st = t.objectStore(STORE); const r = fn(st); t.oncomplete = () => resolve(r && typeof r === 'object' && 'result' in r ? r.result : r); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error || new Error('aborted')); }));
  // localStorage fallback (small banks only)
  const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return {}; } };
  const lsWrite = o => { try { localStorage.setItem(LS, JSON.stringify(o)); return true; } catch (e) { return false; } };

  const Library = Foley.Library = {
    backend: 'idb',
    async list() {
      try { const rows = await tx('readonly', st => st.getAll()); Library.backend = 'idb'; return (rows || []).map(r => ({ name: r.name, updated: r.updated, pads: r.pads })).sort((a, b) => b.updated - a.updated); }
      catch (e) { Library.backend = 'localStorage'; const o = lsRead(); return Object.keys(o).map(k => ({ name: k, updated: o[k].updated, pads: o[k].pads })).sort((a, b) => b.updated - a.updated); }
    },
    async save(name, bankJson) {
      const rec = { name, updated: Date.now(), pads: (bankJson.pads || []).length, data: bankJson };
      try { await tx('readwrite', st => st.put(rec)); Library.backend = 'idb'; return rec; }
      catch (e) { const o = lsRead(); o[name] = rec; if (!lsWrite(o)) throw new Error('Could not save: storage unavailable or full'); Library.backend = 'localStorage'; return rec; }
    },
    async load(name) {
      try { const r = await tx('readonly', st => st.get(name)); if (r) return r.data; } catch (e) { /* fall through */ }
      const o = lsRead(); if (o[name]) return o[name].data; throw new Error('No saved bank named "' + name + '"');
    },
    async remove(name) {
      try { await tx('readwrite', st => st.delete(name)); } catch (e) { /* fall through */ }
      const o = lsRead(); if (o[name]) { delete o[name]; lsWrite(o); }
    },
    async rename(from, to) { const data = await Library.load(from); data.bankName = to; await Library.save(to, data); if (from !== to) await Library.remove(from); },
    async exists(name) { try { const r = await tx('readonly', st => st.get(name)); if (r) return true; } catch (e) { } return !!lsRead()[name]; },
    /* Persistent storage request keeps the browser from evicting the library under storage pressure. */
    async persist() { try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { } return false; },
    async usage() { try { if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } } catch (e) { } return null; },
  };
})();
