// Fortsæt-knappen viser næste ulæste besked i indbakken: Shell beder om fokus, Inbox lytter.
let pending: number | null = null;
const listeners = new Set<(id: number) => void>();

export function focusNews(id: number) {
  pending = id;
  for (const l of listeners) l(id);
}

export function takeFocus(): number | null {
  const v = pending;
  pending = null;
  return v;
}

export function onFocusNews(fn: (id: number) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
