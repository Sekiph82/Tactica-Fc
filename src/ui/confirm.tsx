// Spillets egen bekræftelses-popup (i stedet for browserens confirm()).
import { useEffect, useState } from 'react';
import { t } from '../i18n';

interface Req { text: string; ok?: string; danger?: boolean; resolve: (v: boolean) => void }
let push: ((r: Req) => void) | null = null;

/** Spørg brugeren og vent på svaret (Enter = OK, Esc = Annuller) */
export function askConfirm(text: string, opts?: { ok?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    if (!push) { resolve(window.confirm(text)); return; }
    push({ text, ...opts, resolve });
  });
}

/** Monteres én gang øverst i appen */
export function ConfirmHost() {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => { push = setReq; return () => { push = null; }; }, []);
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); answer(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); answer(true); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!req) return null;
  const answer = (v: boolean) => { req.resolve(v); setReq(null); };
  return (
    <div className="modal-bg confirm-bg" onClick={() => answer(false)}>
      <div className="modal confirm-box" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p>{req.text}</p>
        <div className="row confirm-btns">
          <button onClick={() => answer(false)}>{t('common.cancel')}</button>
          <button className={req.danger ? 'danger primary' : 'primary'} autoFocus onClick={() => answer(true)}>{req.ok ?? t('common.ok')}</button>
        </div>
      </div>
    </div>
  );
}
