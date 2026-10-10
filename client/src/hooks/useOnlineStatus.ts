import { useEffect, useState } from 'react';
import { checkHealth } from '../api';

// navigator.onLine only says the device has a network, so we also ping the server.
export function useOnlineStatus(): boolean {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [serverReachable, setServerReachable] = useState(navigator.onLine);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (!navigator.onLine) {
        setServerReachable(false);
        return;
      }
      const ok = await checkHealth();
      if (!cancelled) setServerReachable(ok);
    };

    const goOnline = () => {
      setBrowserOnline(true);
      void check();
    };
    const goOffline = () => {
      setBrowserOnline(false);
      setServerReachable(false);
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    void check();
    const timer = window.setInterval(() => void check(), 15_000);

    return () => {
      cancelled = true;
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.clearInterval(timer);
    };
  }, []);

  return browserOnline && serverReachable;
}