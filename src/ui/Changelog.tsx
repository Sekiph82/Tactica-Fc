// Version og changelog: lille knap nederst i menuen, der viser hvad der er nyt.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { dateFmt, getLang, t } from '../i18n';
import { APP_VERSION, CHANGELOG } from './changelogData';
import { Modal } from './components';

const SEEN = 'cm0102.seenVersion';

function seenVersion(): string {
  try { return localStorage.getItem(SEEN) ?? ''; } catch { return ''; }
}

export function VersionButton() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(seenVersion);
  const fresh = seen !== APP_VERSION;
  const show = () => {
    setOpen(true);
    try { localStorage.setItem(SEEN, APP_VERSION); } catch { /* ignorer */ }
    setSeen(APP_VERSION);
  };
  return (
    <>
      <button className="nav-version" onClick={(e) => { e.stopPropagation(); show(); }} title={t('changelog.title')}>
        <span>v{APP_VERSION}</span>
        <span className="muted">· {t('changelog.short')}</span>
        {fresh && <span className="tag good">{t('changelog.new')}</span>}
      </button>
      {/* vinduet tegnes uden for menuen, så menuens knapstil ikke rammer det */}
      {open && createPortal(<ChangelogModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const lang = getLang() === 'da' ? 'da' : 'en';
  return (
    <Modal title={t('changelog.title')} onClose={onClose}>
      <div className="changelog">
        {CHANGELOG.map((e, i) => (
          <section key={e.version} className="cl-entry">
            <header>
              <span className={`cl-version ${i === 0 ? 'latest' : ''}`}>v{e.version}</span>
              <b>{e.title[lang]}</b>
              <span className="muted cl-date">{dateFmt(e.date)}</span>
            </header>
            <ul>{e.items.map((it, k) => <li key={k}>{it[lang]}</li>)}</ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
