/* db.js — camada de dados (IndexedDB). Todos os dados ficam só neste aparelho. */
const DB = (() => {
  const NAME = 'meucorpo';
  const VERSION = 2;
  const STORES = {
    settings:   { key: 'key' },                                  // configurações e metas por mês
    foods:      { key: 'id', idx: ['name', 'brand', 'fav'] },    // biblioteca de alimentos
    diary:      { key: 'id', idx: ['date', 'meal'] },            // itens consumidos (só hoje e amanhã)
    favMeals:   { key: 'id' },                                   // refeições salvas
    activities: { key: 'id', idx: ['date'] },                    // cardio
    workouts:   { key: 'id' },                                   // fichas de treino (uma por dia da semana)
    sessions:   { key: 'id', idx: ['date', 'workoutId'] },       // exercícios marcados como feitos no dia
    weights:    { key: 'id', idx: ['date'] },                    // pesagens
    measures:   { key: 'id', idx: ['date'] },                    // medidas corporais
    photos:     { key: 'id' },                                   // fotos dos exercícios (Blob)
    daily:      { key: 'date' }                                  // resumo de cada dia (kcal, meta da época, cardio)
  };
  let db;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, cfg] of Object.entries(STORES)) {
          if (d.objectStoreNames.contains(name)) continue;
          const s = d.createObjectStore(name, { keyPath: cfg.key });
          (cfg.idx || []).forEach(i => s.createIndex(i, i));
        }
      };
      req.onsuccess = () => { db = req.result; db.onversionchange = () => db.close(); resolve(db); };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Feche outras abas do app e tente de novo'));
    });
  }
  const run = (store, mode, fn) => open().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const out = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transação cancelada'));
  }));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

  // Substitui o conteúdo de vários stores numa única transação: se algo falhar, nada é apagado.
  const replaceAll = (data) => open().then(d => new Promise((resolve, reject) => {
    const names = Object.keys(data);
    const tx = d.transaction(names, 'readwrite');
    for (const n of names) { const st = tx.objectStore(n); st.clear(); for (const r of data[n]) st.put(r); }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Restauração cancelada; seus dados atuais foram mantidos'));
  }));

  return {
    STORES, VERSION, uid, open, replaceAll,
    get:   (s, k) => run(s, 'readonly', st => st.get(k)),
    all:   (s) => run(s, 'readonly', st => st.getAll()),
    where: (s, idx, v) => run(s, 'readonly', st => st.index(idx).getAll(v)),
    put:   (s, v) => run(s, 'readwrite', st => st.put(v)),
    del:   (s, k) => run(s, 'readwrite', st => st.delete(k)),
    clear: (s) => run(s, 'readwrite', st => st.clear()),
    async getSetting(key, fallback) { const r = await this.get('settings', key); return r ? r.value : fallback; },
    setSetting(key, value) { return this.put('settings', { key, value }); }
  };
})();
