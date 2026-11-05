import type { Moment, Track } from '../types';

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('afterglow-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('tracks', { keyPath: 'id' });
      request.result.createObjectStore('moments', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error('请关闭旧版本页面后重试。')); };
  });
  return database;
}

async function transact<T>(store: 'tracks' | 'moments', mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('保存已中断'));
  });
}
export const storage = {
  tracks: () => transact<Track[]>('tracks', 'readonly', (s) => s.getAll()),
  moments: () => transact<Moment[]>('moments', 'readonly', (s) => s.getAll()),
  saveTrack: (track: Track) => transact('tracks', 'readwrite', (s) => s.put(track)),
  saveMoment: (moment: Moment) => transact('moments', 'readwrite', (s) => s.put(moment)),
  deleteMoment: (id: string) => transact('moments', 'readwrite', (s) => s.delete(id)),
};

export function downloadFile(name: string, content: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
