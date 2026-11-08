import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { call, initApi, ApiError } from './api';
import { refreshPushToken } from './push';
import type { Me } from './types';

type Ctx = {
  ready: boolean; me: Me | null; error: ApiError | null; loading: boolean;
  refresh: () => Promise<Me | null>; setMe: (m: Me | null) => void; reinit: () => Promise<void>;
};
const StoreCtx = createContext<Ctx>(null as any);
export const useStore = () => useContext(StoreCtx);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef<Promise<Me | null> | null>(null);

  const refresh = useCallback(async () => {
    if (inflight.current) return inflight.current;
    setLoading(true);
    inflight.current = call<Me>('GET', '/me').then(m => { setMe(m); setError(null); return m; },
      (e: ApiError) => { setError(e); return null; }).finally(() => { setLoading(false); inflight.current = null; });
    return inflight.current;
  }, []);

  const reinit = useCallback(async () => {
    try { await initApi(); setError(null); await refresh(); refreshPushToken().catch(() => {}); } catch (e: any) { setError(e); } finally { setReady(true); }
  }, [refresh]);

  useEffect(() => { reinit(); }, [reinit]);
  // 앱이 앞으로 올 때와 20초마다 상태를 다시 읽는다(서버가 상태의 유일한 기준)
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refresh(); });
    const t = setInterval(() => { if (AppState.currentState === 'active') refresh(); }, 20000);
    return () => { sub.remove(); clearInterval(t); };
  }, [refresh]);

  return <StoreCtx.Provider value={{ ready, me, error, loading, refresh, setMe, reinit }}>{children}</StoreCtx.Provider>;
}
