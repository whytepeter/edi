import { useEffect, useState } from 'react';
import { defaultSettings, type Settings } from '@edi/contracts';
import '../lib/bridge';

/** Live preferences from main. Falls back to defaults outside Electron. */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!window.edi) return;
    let alive = true;
    window.edi
      .settings()
      .then(value => alive && setSettings(value))
      .catch(() => alive && setError('Could not load your preferences.'));
    const unsubscribe = window.edi.onSettings(setSettings);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return { settings, setSettings, error };
}
