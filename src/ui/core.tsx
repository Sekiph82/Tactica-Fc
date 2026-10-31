import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getVersion, gs, hasGame, subscribe } from '../game/state';
import type { GameState } from '../game/types';

/** Re-render når spiltilstanden ændres */
export function useGame(): GameState | null {
  useSyncExternalStore(subscribe, getVersion);
  return hasGame() ? gs() : null;
}

export type ScreenName =
  | 'inbox' | 'squad' | 'player' | 'tactics' | 'training' | 'fixtures' | 'competitions' | 'transfers' | 'scouting'
  | 'staff' | 'finance' | 'club' | 'assistant' | 'match' | 'report' | 'history' | 'jobs' | 'options' | 'benchmark' | 'compare' | 'awards' | 'press' | 'ranking' | 'help' | 'managers' | 'board' | 'profile' | 'community' | 'support' | 'draft';

export interface Route {
  name: ScreenName;
  id?: number | string;
  tab?: string;
  /** Skærmens egen tilstand (faneblade, filtre, sortering) – huskes når man går tilbage */
  state?: Record<string, unknown>;
  scroll?: number;
}

// Scroll-containeren registreres af Shell, så scroll-position kan gemmes pr. skærm
let scrollEl: HTMLElement | null = null;
export function setScrollElement(el: HTMLElement | null) {
  scrollEl = el;
}

interface NavCtx {
  route: Route;
  nav: (r: Route) => void;
  back: () => void;
  canBack: boolean;
}

const Ctx = createContext<NavCtx>({ route: { name: 'inbox' }, nav: () => {}, back: () => {}, canBack: false });

/** Navigationshistorikken gemmes i sessionStorage, så en genindlæsning af browseren bliver på samme side */
function loadStack(key: string | undefined): Route[] | null {
  if (!key) return null;
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Route[] | null;
    return Array.isArray(v) && v.length && v.every((r) => typeof r?.name === 'string') ? v : null;
  } catch { return null; }
}

export function NavProvider({ children, initial, storageKey, valid }: { children: ReactNode; initial?: Route; storageKey?: string; valid?: (r: Route) => boolean }) {
  const [stack, setStack] = useState<Route[]>(() => {
    const saved = loadStack(storageKey)?.filter((r) => !valid || valid(r));
    return saved?.length ? saved : [initial ?? { name: 'inbox' }];
  });
  useEffect(() => {
    if (!storageKey) return;
    const save = () => {
      const top = stack[stack.length - 1];
      top.scroll = scrollEl?.scrollTop ?? top.scroll;
      try { sessionStorage.setItem(storageKey, JSON.stringify(stack.slice(-30))); } catch { /* fuld eller blokeret */ }
    };
    save();
    // skærmenes egen tilstand (faner, filtre) og scroll ændres uden ny rute – gem også lige før siden lukkes
    window.addEventListener('pagehide', save);
    return () => window.removeEventListener('pagehide', save);
  }, [stack, storageKey]);
  const value = useMemo<NavCtx>(() => ({
    route: stack[stack.length - 1],
    nav: (r) => setStack((s) => {
      const top = s[s.length - 1];
      if (top.name === r.name && top.id === r.id && top.tab === r.tab) return s;
      top.scroll = scrollEl?.scrollTop ?? 0;
      return [...s.slice(-30), { ...r }];
    }),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    canBack: stack.length > 1,
  }), [stack]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNav() {
  return useContext(Ctx);
}

/**
 * Som useState, men værdien gemmes på den aktuelle rute. Går man videre til en anden skærm og
 * tilbage igen, står faneblade, filtre og valg præcis som de var.
 */
export function useRouteState<T>(key: string, init: T | (() => T)): [T, (v: T) => void] {
  const { route } = useNav();
  const [, force] = useState(0);
  if (!route.state) route.state = {};
  if (!(key in route.state)) route.state[key] = typeof init === 'function' ? (init as () => T)() : init;
  const value = route.state[key] as T;
  const set = (v: T) => {
    route.state![key] = v;
    force((x) => x + 1);
  };
  return [value, set];
}
