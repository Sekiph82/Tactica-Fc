import { useEffect, useState } from 'react';
import { aiAvailable, aiWanted } from '../ai/client';
import { useGame } from './core';

/** Er AI-teksterne tilgængelige (endpoint findes og AI er slået til i indstillingerne)? */
export function useAiAvailable(): boolean {
  const g = useGame();
  const [ok, setOk] = useState(false);
  useEffect(() => { let alive = true; aiAvailable().then((v) => { if (alive) setOk(v); }); return () => { alive = false; }; }, []);
  void g;
  return ok && aiWanted();
}
