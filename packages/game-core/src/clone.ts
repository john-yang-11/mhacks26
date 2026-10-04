/** Game state contains only JSON values; this works in browsers and SpacetimeDB V8. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
