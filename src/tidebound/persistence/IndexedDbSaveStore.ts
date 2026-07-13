export interface SaveStore<T = unknown> {
  load(): Promise<T | undefined>;
  save(value: T): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export interface IndexedDbSaveStoreOptions {
  databaseName?: string;
  databaseVersion?: number;
  objectStoreName?: string;
  saveKey?: IDBValidKey;
  indexedDB?: IDBFactory;
}

const DEFAULT_DATABASE_NAME = "wayfinders";
const DEFAULT_DATABASE_VERSION = 1;
const DEFAULT_OBJECT_STORE = "saveGames";
const DEFAULT_SAVE_KEY = "autosave";

/** Thin, simulation-independent IndexedDB adapter for one atomic autosave. */
export class IndexedDbSaveStore<T = unknown> implements SaveStore<T> {
  private readonly databaseName: string;
  private readonly databaseVersion: number;
  private readonly objectStoreName: string;
  private readonly saveKey: IDBValidKey;
  private readonly indexedDb: IDBFactory | undefined;
  private databasePromise?: Promise<IDBDatabase>;
  private database?: IDBDatabase;

  constructor(options: IndexedDbSaveStoreOptions = {}) {
    this.databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    this.databaseVersion = options.databaseVersion ?? DEFAULT_DATABASE_VERSION;
    this.objectStoreName = options.objectStoreName ?? DEFAULT_OBJECT_STORE;
    this.saveKey = options.saveKey ?? DEFAULT_SAVE_KEY;
    this.indexedDb = options.indexedDB ?? globalThis.indexedDB;
    if (!Number.isInteger(this.databaseVersion) || this.databaseVersion <= 0) {
      throw new RangeError("IndexedDB databaseVersion must be a positive integer");
    }
  }

  async load(): Promise<T | undefined> {
    const database = await this.open();
    const transaction = database.transaction(this.objectStoreName, "readonly");
    const request = transaction.objectStore(this.objectStoreName).get(this.saveKey);
    const result = await requestResult<T | undefined>(request);
    await transactionCompletion(transaction);
    return result;
  }

  async save(value: T): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(this.objectStoreName, "readwrite");
    transaction.objectStore(this.objectStoreName).put(value, this.saveKey);
    await transactionCompletion(transaction);
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(this.objectStoreName, "readwrite");
    transaction.objectStore(this.objectStoreName).delete(this.saveKey);
    await transactionCompletion(transaction);
  }

  close(): void {
    this.database?.close();
    this.database = undefined;
    this.databasePromise = undefined;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.indexedDb) return Promise.reject(new Error("IndexedDB is unavailable"));
    if (this.database) return Promise.resolve(this.database);
    if (this.databasePromise) return this.databasePromise;

    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDb?.open(this.databaseName, this.databaseVersion);
      if (!request) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.objectStoreName)) {
          database.createObjectStore(this.objectStoreName);
        }
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade was blocked by another tab"));
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.objectStoreName)) {
          database.close();
          reject(new Error(`IndexedDB object store ${this.objectStoreName} is missing`));
          return;
        }
        database.onversionchange = () => this.close();
        this.database = database;
        resolve(database);
      };
    }).catch((error: unknown) => {
      this.databasePromise = undefined;
      throw error;
    });
    return this.databasePromise;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}
