import { useEffect, useState } from 'react';
import type { SystemInfo } from '@edi/contracts';

/** Runtime availability from main. Refetched whenever `key` changes; null while unknown. */
export function useSystemInfo(key: string | null) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
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
  }, [key]);
  return info;
}
