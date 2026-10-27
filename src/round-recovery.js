(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GolfRoundRecovery = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RETENTION_MS = 30 * 86400000;
  const clone = value => JSON.parse(JSON.stringify(value));
  const uuid = () => globalThis.crypto.randomUUID();
  function cleanVault(data, now = Date.now()) {
    return { version: 1, drafts: Array.isArray(data?.drafts) ? data.drafts : [],
      trash: (Array.isArray(data?.trash) ? data.trash : []).filter(item => item.deletedAt > now - RETENTION_MS),
      removedDrafts: (Array.isArray(data?.removedDrafts) ? data.removedDrafts : []).filter(item => item.at > now - RETENTION_MS) };
  }
  function saveDraft(data, snapshot, expectedRevision = 0, now = Date.now()) {
    const vault = cleanVault(data, now), state = clone(snapshot);
    let id = state.draftId || uuid();
    const existing = vault.drafts.find(item => item.id === id);
    const forked = (existing ? existing.revision !== expectedRevision : expectedRevision > 0) || vault.removedDrafts.some(item => item.id === id);
    if (forked) id = uuid();
    if ((!existing || forked) && vault.drafts.length >= 100) throw new Error('Du kan spara högst 100 utkast. Radera ett gammalt utkast först.');
    const revision = forked ? 1 : (existing?.revision || 0) + 1;
    const hasScore = (state.scores || []).some(row => row.some(score => score !== '' && score != null));
    const draft = { id, revision, name: String(state.draftName || state.courseName || 'Utkast').slice(0, 80),
      status: hasScore ? 'in_progress' : 'draft', updatedAt: now,
      state: { ...state, draftId: id, draftRevision: revision } };
    if (forked) { draft.name = `${draft.name.slice(0, 65)} · konfliktkopia`; draft.state.draftName = draft.name; }
    vault.drafts = [...vault.drafts.filter(item => item.id !== id), draft];
    return { vault, value: { draft, forked } };
  }
  function removeDraft(data, id, now = Date.now()) {
    const vault = cleanVault(data, now);
    vault.drafts = vault.drafts.filter(item => item.id !== id);
    vault.removedDrafts = [...vault.removedDrafts.filter(item => item.id !== id), { id, at: now }];
    return { vault, value: true };
  }
  function archiveRound(data, round, now = Date.now()) {
    const vault = cleanVault(data, now);
    const existing = vault.trash.find(item => String(item.round.id) === String(round.id));
    if (existing) return { vault, value: existing };
    if (vault.trash.length >= 200) throw new Error('Papperskorgen är full. Radera en gammal post permanent först.');
    const entry = { id: uuid(), deletedAt: now, round: clone(round) };
    vault.trash.push(entry);
    return { vault, value: entry };
  }
  function prepareRestore(data, id, now = Date.now()) {
    const vault = cleanVault(data, now), entry = vault.trash.find(item => item.id === id);
    if (!entry) throw new Error('Rundan finns inte längre i papperskorgen.');
    entry.restoreId ||= `restored_${uuid()}`;
    const round = { ...clone(entry.round), id: entry.restoreId, restoredFrom: String(entry.round.id),
      lifecycle: 'completed', tourRef: null, liveRoomCode: null };
    // A restored local copy cannot be mistaken for an active draft or resubmission.
    delete round.sourceDraftId;
    return { vault, value: round };
  }
  function forgetTrash(data, id, now = Date.now()) {
    const vault = cleanVault(data, now);
    vault.trash = vault.trash.filter(item => item.id !== id);
    return { vault, value: true };
  }
  function createStore(indexedDB, databaseName = 'golf_round_recovery_v1') {
    let opening;
    function open() {
      if (!indexedDB) return Promise.reject(new Error('Återhämtning kräver tillgänglig lokal databas.'));
      if (!opening) opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('vaults');
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Stäng andra gamla appflikar och försök igen.'));
        request.onsuccess = () => {
          request.result.onversionchange = () => { request.result.close(); opening = null; };
          resolve(request.result);
        };
      }).catch(error => { opening = null; throw error; });
      return opening;
    }
    async function transact(key, reducer) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('vaults', reducer ? 'readwrite' : 'readonly');
        const store = tx.objectStore('vaults'), request = store.get(key);
        let value, failure;
        request.onsuccess = () => {
          try {
            if (!reducer) value = cleanVault(request.result);
            else { const next = reducer(request.result); value = next.value; store.put(next.vault, key); }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Kunde inte spara återhämtningsdata.'));
      });
    }
    return Object.freeze({
      list: key => transact(key),
      saveDraft: (key, state, revision) => transact(key, data => saveDraft(data, state, revision)),
      removeDraft: (key, id) => transact(key, data => removeDraft(data, id)),
      archiveRound: (key, round) => transact(key, data => archiveRound(data, round)),
      prepareRestore: (key, id) => transact(key, data => prepareRestore(data, id)),
      forgetTrash: (key, id) => transact(key, data => forgetTrash(data, id)),
    });
  }
  return Object.freeze({ RETENTION_MS, cleanVault, saveDraft, removeDraft, archiveRound, prepareRestore, forgetTrash, createStore });
}));
