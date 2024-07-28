export interface Pair {
  [x:string | number | symbol]: any
}

export abstract class BaseStore<V, K=string>{
  abstract set(key: K, value:V ): Promise<void>;
  abstract get(key: K): Promise<Awaited<V> | undefined | V>
  abstract del(key: K): Promise<void>;
  abstract has(key: K): Promise<boolean>;

  abstract hset(ns: K, pair: Pair): Promise<void>;
  abstract hget(ns: K, key: K): Promise<V>;
  abstract hdel(ns: K, key: K[]): Promise<void>;
  abstract hhas(ns: K, key: K): Promise<boolean>;

  abstract sset(ns: K, value:V): Promise<void>;
  abstract sdel(ns: K, value: V): Promise<void>;
  abstract shas(ns: K, value:V): Promise<boolean>;
}