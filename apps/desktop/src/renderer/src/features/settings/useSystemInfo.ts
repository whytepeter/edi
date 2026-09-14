import { useCallback, useEffect, useState } from 'react';
import type { SystemInfo } from '@edi/contracts';

/**
 * Runtime availability from main. Refetched whenever `key` changes, or when `refresh` is called
 * after something main tracks changes (a voice key saved or removed); null while unknown.
 */
export function useSystemInfo(key: string | null) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (key === null || !window.edi) return;
    let alive = true;
    window.edi
      .system()
      .then(value => alive && setInfo(value))
      .catch(() => alive && setInfo(null));
    return () => {
      alive = false;
    };
  }, [key, revision]);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  return [info, refresh] as const;
}
