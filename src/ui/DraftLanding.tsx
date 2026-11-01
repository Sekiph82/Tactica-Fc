// Landingsside for Draft-ligaen (?draft=1): hvad det er, hvordan det virker, og det sjove ved det.
import { useEffect, useState } from 'react';
import type { Lang } from '../game/types';
import { getLang, setLang, t } from '../i18n';
import { Counter, Frame, useReveal } from './Landing';
import './landing.css';

const img = (name: string) => `${import.meta.env.BASE_URL}landing/${name}.webp`;

/** En animeret draft: spillerne lander på deres pladser én ad gangen, mens uret tæller ned */
const MOCK: [string, number, number, number][] = [
  // navn, x (venstre→højre %), y (top→bund %), evne
  ['Mbappé', 50, 14, 97], ['Yamal', 82, 22, 93], ['Vinícius', 18, 22, 92], ['Bellingham', 50, 36, 92], ['Rice', 30, 48, 91], ['Pedri', 70, 48, 91],
  ['Saliba', 38, 70, 90], ['Van Dijk', 62, 70, 89], ['Hakimi', 86, 64, 88], ['Mendes', 14, 64, 87], ['Courtois', 50, 88, 86],
];
function DraftMock() {
  const [n, setN] = useState(0);
  const [clock, setClock] = useState(60);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setN(MOCK.length); return; }
    const h = setInterval(() => setN((x) => (x >= MOCK.length + 3 ? 0 : x + 1)), 1100);
    const c = setInterval(() => setClock((x) => (x <= 1 ? 60 : x - 1)), 160);
    return () => { clearInterval(h); clearInterval(c); };
  }, []);
  const next = MOCK[Math.min(n, MOCK.length - 1)];
  return (
    <div className="dl-mock">
      <div className="dl-mock-bar">
        <span className="dl-mock-crest">ANA</span>
        <div><small>{t('dl.mockPick', { n: Math.min(n + 1, MOCK.length) })}</small><b>{n < MOCK.length ? t('dl.mockYourPick') : t('dl.mockDone')}</b></div>
        <span className={`dl-mock-clock ${clock <= 10 ? 'warn' : ''}`}>{clock}s</span>
      </div>
      <div className="dl-mock-pitch">
        <i className="dl-mock-line" />
        {MOCK.map(([name, x, y, r], i) => (
          <div key={name} className={`dl-mock-spot ${i < n ? 'on' : ''} ${i === n ? 'next' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}>
            <span className="dl-mock-dot">{i < n ? r : ''}</span>
            <span className="dl-mock-name">{i < n ? name : ''}</span>
          </div>
        ))}
      </div>
      {n < MOCK.length && <div className="dl-mock-toast" key={n}>💡 {t('dl.mockSuggest', { name: next[0] })}</div>}
    </div>
  );
}

const STEPS = ['club', 'draft', 'season', 'again'];
const FUN: [string, string][] = [
  ['⏱️', 'clock'], ['🐍', 'snake'], ['⭐', 'wish'], ['💡', 'assistant'],
  ['🎙️', 'voice'], ['🤖', 'ai'], ['🔁', 'keepers'], ['🏆', 'playoff'],
  ['⚡', 'today'], ['📊', 'finale'], ['🛡️', 'crest'], ['⚖️', 'fair'],
];

export function DraftLanding({ onCreate, onBack, onLang }: { onCreate: () => void; onBack: () => void; onLang: (l: Lang) => void }) {
  useReveal();
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const lang = getLang();
  useEffect(() => { document.title = t('dl.docTitle'); window.scrollTo(0, 0); }, [lang]);
  const switchLang = (l: Lang) => { setLang(l); onLang(l); };
  const open = (src: string, alt: string) => setLightbox({ src, alt });
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const Cta = ({ big }: { big?: boolean }) => <button className={`lp-cta ${big ? 'big' : ''}`} onClick={onCreate}>{t('dl.cta')} <span aria-hidden="true">→</span></button>;
  return (
    <div className="lp dl">
      <div className="lp-aurora" aria-hidden="true"><i /><i /><i /></div>
      <header className="lp-nav solid">
        <div className="lp-wrap lp-nav-in">
          <a className="lp-brand" onClick={onBack} style={{ cursor: 'pointer' }}><img src={`${import.meta.env.BASE_URL}tactica-brand/Tactica_FC_Black_Metal_32x32.png?v=25`} alt="" width="28" height="28" /> <b>TACTICA</b> <span>FC</span> <em className="dl-badge">Draft</em></a>
          <nav className="lp-links">
            <a onClick={() => go('how')}>{t('dl.nav.how')}</a>
            <a onClick={() => go('fun')}>{t('dl.nav.fun')}</a>
            <a onClick={() => go('shots')}>{t('dl.nav.shots')}</a>
          </nav>
          <div className="lp-nav-right">
            <div className="lp-lang">
              <button className={lang === 'da' ? 'on' : ''} onClick={() => switchLang('da')}>DA</button>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => switchLang('en')}>EN</button>
              <button className={lang === 'tr' ? 'on' : ''} onClick={() => switchLang('tr')}>TR</button>
            </div>
            <button className="lp-cta small" onClick={onCreate}>{t('dl.ctaShort')}</button>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-text">
            <div className="lp-pill reveal"><span className="lp-live" /> {t('dl.pill')}</div>
            <h1 className="reveal">{t('dl.h1a')} <span className="lp-grad">{t('dl.h1b')}</span></h1>
            <p className="lp-lead reveal">{t('dl.lead')}</p>
            <div className="lp-hero-ctas reveal">
              <Cta big />
              <button className="lp-ghost" onClick={() => go('how')}>{t('dl.seeHow')}</button>
            </div>
            <ul className="lp-checks reveal">
              {['free', 'friends', 'live', 'nomoney'].map((k) => <li key={k}>✓ {t(`dl.check.${k}`)}</li>)}
            </ul>
          </div>
          <div className="lp-hero-visual reveal dl-hero-visual">
            <DraftMock />
            <div className="lp-float goal">🎙️ {t('dl.floatVoice')}</div>
            <div className="lp-float bid">🔥 {t('dl.floatSteal')}</div>
          </div>
        </div>
      </section>

      <section className="lp-stats lp-wrap">
        {[[500, '', 'pool'], [60, 's', 'clock'], [16, '', 'clubs'], [16, '', 'squad']].map(([n, s, k]) => (
          <div key={k as string} className="lp-stat reveal"><b><Counter to={n as number} suffix={s as string} /></b><span>{t(`dl.stat.${k}`)}</span></div>
        ))}
      </section>

      <section id="how" className="lp-section lp-wrap">
        <h2 className="reveal">{t('dl.howTitle')}</h2>
        <p className="lp-sub reveal">{t('dl.howSub')}</p>
        <div className="lp-steps dl-steps">
          {STEPS.map((k, i) => (
            <div key={k} className="lp-step reveal" style={{ transitionDelay: `${i * 90}ms` }}>
              <span>{i + 1}</span>
              <h3>{t(`dl.step.${k}.title`)}</h3>
              <p>{t(`dl.step.${k}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="fun" className="lp-section lp-wrap">
        <h2 className="reveal">{t('dl.funTitle')}</h2>
        <p className="lp-sub reveal">{t('dl.funSub')}</p>
        <div className="lp-grid dl-grid">
          {FUN.map(([icon, k], i) => (
            <div key={k} className="lp-card reveal" style={{ transitionDelay: `${(i % 4) * 70}ms` }}>
              <div className="lp-card-icon">{icon}</div>
              <h3>{t(`dl.f.${k}.title`)}</h3>
              <p>{t(`dl.f.${k}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="shots" className="lp-section lp-wrap">
        <h2 className="reveal">{t('dl.shotsTitle')}</h2>
        <p className="lp-sub reveal">{t('dl.shotsSub')}</p>
        <div className="dl-shots">
          {(['lobby', 'live', 'summary'] as const).map((k) => (
            <figure key={k} className="reveal">
              <Frame src={img(`draft-${k}`)} alt={t(`dl.shot.${k}`)} onOpen={open} />
              <figcaption><b>{t(`dl.shot.${k}`)}</b> {t(`dl.shot.${k}.text`)}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-wrap">
          <h2 className="reveal">{t('dl.finalTitle')}</h2>
          <p className="reveal">{t('dl.finalText')}</p>
          <Cta big />
          <div style={{ marginTop: 18 }}><a className="lp-ghost-link" onClick={onBack}>← {t('dl.back')}</a></div>
        </div>
      </section>

      {lightbox && (
        <div className="lp-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label={lightbox.alt}>
          <img src={lightbox.src} alt={lightbox.alt} />
          <button className="lp-close" aria-label={t('common.close')}>×</button>
        </div>
      )}
    </div>
  );
}
