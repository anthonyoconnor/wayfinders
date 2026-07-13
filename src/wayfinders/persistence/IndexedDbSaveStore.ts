export type ValidatedSlotLoadResult<T> =
  | { status: "empty" }
  | { status: "loaded"; value: T }
  | { status: "discarded"; error: unknown; removed: boolean; removalError?: unknown };

export interface ValidatedSlotStore<T = unknown> {
  loadAndDeleteRejected<TResult>(
    validate: (value: T) => TResult,
  ): Promise<ValidatedSlotLoadResult<TResult>>;
}

export interface SaveStore<T = unknown> extends ValidatedSlotStore<T> {
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

/** Thin, simulation-independent IndexedDB adapter for one atomic save slot. */
export class IndexedDbSaveStore<T = unknown> implements SaveStore<T> {
  private readonly databaseName: string;
  private readonly databaseVersion: number;
  private readonly objectStoreName: string;
  private readonly saveKey: IDBValidKey;
  private readonly indexedDb: IDBFactory | undefined;
  private databasePromise?: Promise<IDBDatabase>;
  private database?: IDBDatabase;
  private connectionEpoch = 0;
  private rejectPendingOpen?: (reason: Error) => void;

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

  /** Validates and, when rejected, deletes one slot in the same transaction. */
  async loadAndDeleteRejected<TResult>(
    validate: (value: T) => TResult,
  ): Promise<ValidatedSlotLoadResult<TResult>> {
    const database = await this.open();
    const transaction = database.transaction(this.objectStoreName, "readwrite");
    const completion = transactionCompletion(transaction);
    const objectStore = transaction.objectStore(this.objectStoreName);
    let value: T;
    try {
      const count = await requestResult(objectStore.count(this.saveKey));
      if (count === 0) {
        await completion;
        return { status: "empty" };
      }
      value = await requestResult<T>(objectStore.get(this.saveKey));
    } catch (error) {
      try {
        await completion;
      } catch {
        // The read error remains the useful failure for the caller.
      }
      throw error;
    }
    let accepted: TResult;
    try {
      accepted = validate(value);
    } catch (error) {
      try {
        objectStore.delete(this.saveKey);
        await completion;
        return { status: "discarded", error, removed: true };
      } catch (removalError) {
        try {
          await completion;
        } catch (transactionError) {
          removalError = transactionError;
        }
        return { status: "discarded", error, removed: false, removalError };
      }
    }

    await completion;
    return { status: "loaded", value: accepted };
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
    this.connectionEpoch++;
    this.rejectPendingOpen?.(new Error("IndexedDB connection was closed while opening"));
    this.rejectPendingOpen = undefined;
    this.database?.close();
    this.database = undefined;
    this.databasePromise = undefined;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.indexedDb) return Promise.reject(new Error("IndexedDB is unavailable"));
    if (this.database) return Promise.resolve(this.database);
    if (this.databasePromise) return this.databasePromise;

    const epoch = this.connectionEpoch;
    let settled = false;
    const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        if (this.rejectPendingOpen === rejectOnce) this.rejectPendingOpen = undefined;
        reject(error);
      };
      this.rejectPendingOpen = rejectOnce;
      const request = this.indexedDb?.open(this.databaseName, this.databaseVersion);
      if (!request) {
        rejectOnce(new Error("IndexedDB is unavailable"));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.objectStoreName)) {
          database.createObjectStore(this.objectStoreName);
        }
      };
      request.onerror = () => rejectOnce(request.error ?? new Error("Could not open IndexedDB"));
      request.onblocked = () => rejectOnce(new Error("IndexedDB upgrade was blocked by another tab"));
      request.onsuccess = () => {
        const database = request.result;
        if (settled || epoch !== this.connectionEpoch) {
          database.close();
          return;
        }
        if (!database.objectStoreNames.contains(this.objectStoreName)) {
          database.close();
          rejectOnce(new Error(`IndexedDB object store ${this.objectStoreName} is missing`));
          return;
        }
        settled = true;
        if (this.rejectPendingOpen === rejectOnce) this.rejectPendingOpen = undefined;
        database.onversionchange = () => {
          if (this.database === database) this.close();
          else database.close();
        };
        database.onclose = () => {
          if (this.database !== database) return;
          this.database = undefined;
          this.databasePromise = undefined;
          this.connectionEpoch++;
        };
        this.database = database;
        resolve(database);
      };
    });
    this.databasePromise = openPromise;
    void openPromise.catch(() => {
      if (this.databasePromise === openPromise) this.databasePromise = undefined;
    });
    return openPromise;
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
