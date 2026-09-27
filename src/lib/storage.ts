import { useEffect, useState } from 'react';

/** useState that survives reloads. Storage can be unavailable (private mode), so every access is guarded. */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`rondo:${key}`);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(`rondo:${key}`, JSON.stringify(value)); } catch { /* ignore */ }
  }, [key, value]);
  return [value, setValue] as const;
}
