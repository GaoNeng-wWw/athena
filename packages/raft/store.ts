export interface Pair {
  [x:string | number | symbol]: any
}

export abstract class BaseStore<V, K=string>{
  abstract set(key: K, value:V ): Promise<void>;
  abstract get(key: K): Promise<Awaited<V> | undefined | V>
  abstract del(key: K): Promise<void>;
  abstract has(key: K): Promise<boolean>;

  abstract hset(ns: K, pair: Pair): Promise<void>;
  abstract hget(ns: K, key: K): Promise<V | undefined>;
  abstract hdel(ns: K, key: K[]): Promise<void>;
  abstract hhas(ns: K, key: K): Promise<boolean>;

  abstract sset(ns: K, value: [V]): Promise<void>;
  abstract sdel(ns: K, value: [V]): Promise<void>;
  abstract shas(ns: K, value:V): Promise<boolean>;
}

export class MemoryStore implements BaseStore<string, string> {
  async has(key: string): Promise<boolean> {
    return this.store.has(key) ?? false;
  }
  async hhas(ns: string, key: string): Promise<boolean> {
    const v = this.store.get(ns);
    return v && this.store.has(key);
  }
  private store = new Map();

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string> {
    return this.store.get(key);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async hset(hashKey: string, pairs: [string]): Promise<void> {
    let hash = this.store.get(hashKey);
    if (!hash) {
      hash = new Map();
      this.store.set(hashKey, hash);
    }

    for ( let i = 0;i < pairs.length; i++) {
      const split = pairs[i].split(":");
      const key = split[0];
      const value = split[1];
      hash.set(key, value);
    }
    this.store.set(hashKey, hash);
  }

  async hget(hashKey: string, key: string): Promise<string | undefined> {
    const hash = this.store.get(hashKey);
    return hash?.get?.(key) ?? undefined;
  }
  
  async hdel(hashKey: string, keys: [string]): Promise<void> {
    const hash = this.store.get(hashKey);
    if (hash) {
      for ( let i = 0; i < keys.length; i++) {
        hash.delete(keys[i]);
      }
    }
  }

  async sset(setKey: string, values: [string]): Promise<void> {
    let set = this.store.get(setKey);
    if (!set) {
      set = new Set();
      this.store.set(setKey, set);
    }

    for ( let i = 0;i < values.length; i++) {
      set.add(values[i]);
    }
    this.store.set(setKey, set);
    return;
  }

  async shas(setKey: string, value: string): Promise<boolean> {
    const set = this.store.get(setKey);
    return set.has(value);
  }
  
  async sdel(setKey: string, values: [string]): Promise<void> {
    const set = this.store.get(setKey);
    if (set) {
      for ( let i = 0; i < values.length; i++) {
        set.delete(values[i]);
      }
    }
  }
}