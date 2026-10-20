/**
 * 見る人が選んだ音源ファイルを、このブラウザの IndexedDB に覚えておく(次に開いたとき選び直さなくてよいように)。
 * ファイルはこのブラウザの中にだけ置き、どこにも送らない。
 * IndexedDB が使えない環境(プライベートモードなど)では、覚えずに続ける。
 */

const DB_NAME = 'world-execute-xr';
const STORE = 'audio';
const KEY = 'track';

interface StoredTrack {
  readonly name: string;
  readonly blob: Blob;
}

/** 前に選んだ音源。無ければ null */
export async function loadStoredAudio(): Promise<File | null> {
  try {
    const db = await openDatabase();
    const value: unknown = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY));
    db.close();
    if (!isStoredTrack(value)) return null;
    return value.blob instanceof File ? value.blob : new File([value.blob], value.name, { type: value.blob.type });
  } catch (error) {
    console.warn('前に選んだ音源を読み出せませんでした', error);
    return null;
  }
}

export async function storeAudio(file: File): Promise<void> {
  try {
    const db = await openDatabase();
    const track: StoredTrack = { name: file.name, blob: file };
    await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(track, KEY));
    db.close();
  } catch (error) {
    console.warn('選んだ音源をブラウザに覚えておけませんでした(次回は選び直しになります)', error);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.addEventListener('upgradeneeded', () => open.result.createObjectStore(STORE));
    open.addEventListener('success', () => resolve(open.result));
    open.addEventListener('error', () => reject(open.error));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener('success', () => resolve(req.result));
    req.addEventListener('error', () => reject(req.error));
  });
}

function isStoredTrack(value: unknown): value is StoredTrack {
  if (typeof value !== 'object' || value === null) return false;
  const { name, blob } = value as Record<string, unknown>;
  return typeof name === 'string' && blob instanceof Blob;
}
