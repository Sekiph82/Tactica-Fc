// Forsiden for nye besøgende: hero med animation, rigtige screenshots, features, rangliste og FAQ.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Lang } from '../game/types';
import { getLang, getNumberLocale, setLang, t } from '../i18n';
import { fetchBoard, rankingAvailable, type RankRow } from '../online/rank';
import './landing.css';

const img = (name: string) => `${import.meta.env.BASE_URL}landing/${name}.webp`;

/** Elementer glider ind, når de kommer i syne */
export function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.lp .reveal');
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

/** Tal der tæller op, når de kommer i syne */
export function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setV(to); return; }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 1400);
        setV(Math.round(to * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref}>{v.toLocaleString(getNumberLocale())}{suffix}</span>;
}

/** Skærmbillede i en browserramme der vipper let efter musen */
export function Frame({ src, alt, className = '', onOpen }: { src: string; alt: string; className?: string; onOpen?: (src: string, alt: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', `${(-y * 6).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
  };
  const leave = () => { ref.current?.style.removeProperty('--rx'); ref.current?.style.removeProperty('--ry'); };
  return (
    <div ref={ref} className={`lp-frame ${className}`} onMouseMove={move} onMouseLeave={leave} onClick={() => onOpen?.(src, alt)} role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={(e) => { if (e.key === 'Enter') onOpen?.(src, alt); }}>
      <div className="lp-frame-bar"><i /><i /><i /><span>TACTICA FC</span></div>
      <img src={src} alt={alt} loading="lazy" decoding="async" />
    </div>
  );
}

/** Animeret bane i hero: spillere der bevæger sig og en bold der skydes i mål */
function Pitch() {
  return (
    <svg className="lp-pitch" viewBox="0 0 400 260" aria-hidden="true">
      <defs>
        <linearGradient id="lpgrass" x1="0" x2="1">
          <stop offset="0" stopColor="#0f5132" /><stop offset="1" stopColor="#14703f" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="260" rx="14" fill="url(#lpgrass)" />
      {[...Array(8)].map((_, i) => <rect key={i} x={i * 50} y="0" width="25" height="260" fill="rgba(255,255,255,0.035)" />)}
      <g stroke="rgba(255,255,255,0.55)" strokeWidth="1.6" fill="none">
        <rect x="10" y="10" width="380" height="240" rx="4" /><line x1="200" y1="10" x2="200" y2="250" /><circle cx="200" cy="130" r="32" />
        <rect x="10" y="70" width="52" height="120" /><rect x="338" y="70" width="52" height="120" />
      </g>
      {[[60, 130], [110, 70], [110, 190], [150, 130], [170, 90], [175, 175]].map(([x, y], i) => <circle key={`h${i}`} className={`lp-dot h d${i}`} cx={x} cy={y} r="7" />)}
      {[[340, 130], [290, 80], [290, 180], [250, 130], [235, 60], [230, 205]].map(([x, y], i) => <circle key={`a${i}`} className={`lp-dot a d${i}`} cx={x} cy={y} r="7" />)}
      <circle className="lp-ball" cx="200" cy="130" r="4.5" />
    </svg>
  );
}

const TICKER = ['tick1', 'tick2', 'tick3', 'tick4', 'tick5', 'tick6', 'tick7', 'tick8'];
const FEATURES: [string, string][] = [
  ['⚽', 'engine'], ['🌍', 'players'], ['🔎', 'scouting'], ['🎙️', 'press'], ['💸', 'transfers'],
  ['🧠', 'ai'], ['🏆', 'ranking'], ['🤝', 'online'], ['📱', 'mobile'],
];
const SHOWCASE: { key: string; imgs: string[] }[] = [
  { key: 'matchday', imgs: ['report', 'match-stats'] },
  { key: 'tactics', imgs: ['tactics', 'match'] },
  { key: 'people', imgs: ['player', 'press'] },
  { key: 'career', imgs: ['table', 'club'] },
];

export function Landing({ onPlay, onLang, onDraft }: { onPlay: () => void; onLang: (l: Lang) => void; onDraft?: () => void }) {
  useReveal();
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [top, setTop] = useState<RankRow[] | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const lang = getLang();
  useEffect(() => {
    document.title = t('land.docTitle');
    if (rankingAvailable()) fetchBoard('career').then((d) => setTop(d?.rows.slice(0, 5) ?? []));
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [lang]);
  useEffect(() => {
    if (!lightbox) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [lightbox]);
  const switchLang = (l: Lang) => { setLang(l); onLang(l); };
  const open = (src: string, alt: string) => setLightbox({ src, alt });
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  const Cta = ({ big, children }: { big?: boolean; children?: ReactNode }) => (
    <button className={`lp-cta ${big ? 'big' : ''}`} onClick={onPlay}>{children ?? t('land.play')} <span aria-hidden="true">→</span></button>
  );

  return (
    <div className="lp">
      <div className="lp-aurora" aria-hidden="true"><i /><i /><i /></div>
      <header className={`lp-nav ${scrolled ? 'solid' : ''}`}>
        <div className="lp-wrap lp-nav-in">
          <div className="lp-brand"><img src={`${import.meta.env.BASE_URL}tactica-brand/Tactica_FC_Black_Metal_32x32.png?v=25`} alt="" width="28" height="28" /> <b>TACTICA</b> <span>FC</span></div>
          <nav className="lp-links">
            <a onClick={() => go('features')}>{t('land.nav.features')}</a>
            <a onClick={() => go('screens')}>{t('land.nav.screens')}</a>
            <a onClick={() => go('ranking')}>{t('land.nav.ranking')}</a>
            <a onClick={() => go('faq')}>{t('land.nav.faq')}</a>
            {onDraft && <a onClick={onDraft}>{t('nav.draft')}</a>}
          </nav>
          <div className="lp-nav-right">
            <div className="lp-lang">
              <button className={lang === 'da' ? 'on' : ''} onClick={() => switchLang('da')}>DA</button>
              <button className={lang === 'en' ? 'on' : ''} onClick={() => switchLang('en')}>EN</button>
              <button className={lang === 'tr' ? 'on' : ''} onClick={() => switchLang('tr')}>TR</button>
            </div>
            <button className="lp-cta small" onClick={onPlay}>{t('land.playShort')}</button>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-text">
            <div className="lp-pill reveal"><span className="lp-live" /> {t('land.pill')}</div>
            <h1 className="reveal">{t('land.h1a')} <span className="lp-grad">{t('land.h1b')}</span></h1>
            <p className="lp-lead reveal">{t('land.lead')}</p>
            <div className="lp-hero-ctas reveal">
              <Cta big />
              <button className="lp-ghost" onClick={() => go('screens')}>{t('land.seeScreens')}</button>
            </div>
            <ul className="lp-checks reveal">
              {['free', 'nodl', 'lang', 'save'].map((k) => <li key={k}>✓ {t(`land.check.${k}`)}</li>)}
            </ul>
          </div>
          <div className="lp-hero-visual reveal">
            <Pitch />
            <Frame src={img('report')} alt={t('land.alt.report')} className="lp-hero-main" onOpen={open} />
            <div className="lp-phone"><img src={img('mobile')} alt={t('land.alt.mobile')} loading="lazy" /></div>
            <div className="lp-float goal">⚽ {t('land.floatGoal')}</div>
            <div className="lp-float bid">💸 {t('land.floatBid')}</div>
          </div>
        </div>
      </section>

      <div className="lp-ticker" aria-hidden="true">
        <div className="lp-ticker-track">
          {[...TICKER, ...TICKER].map((k, i) => <span key={i}>{t(`land.${k}`)}</span>)}
        </div>
      </div>

      <section className="lp-stats lp-wrap">
        {[[20000, '+', 'players'], [662, '', 'clubs'], [38, '', 'leagues'], [240, '', 'moments']].map(([n, s, k]) => (
          <div key={k as string} className="lp-stat reveal"><b><Counter to={n as number} suffix={s as string} /></b><span>{t(`land.stat.${k}`)}</span></div>
        ))}
      </section>

      {onDraft && (
        <section className="lp-section lp-wrap">
          <div className="lp-promo reveal">
            <div>
              <div className="lp-pill"><span className="lp-live" /> {t('land.promoPill')}</div>
              <h2>{t('land.promoTitle')}</h2>
              <p>{t('land.promoText')}</p>
              <button className="lp-cta" onClick={onDraft}>{t('land.promoCta')} <span aria-hidden="true">→</span></button>
            </div>
            <Frame src={img('draft-live')} alt={t('dl.shot.live')} onOpen={open} />
          </div>
        </section>
      )}

      <section id="features" className="lp-section lp-wrap">
        <h2 className="reveal">{t('land.featuresTitle')}</h2>
        <p className="lp-sub reveal">{t('land.featuresSub')}</p>
        <div className="lp-grid">
          {FEATURES.map(([icon, k], i) => (
            <div key={k} className="lp-card reveal" style={{ transitionDelay: `${(i % 3) * 80}ms` }}>
              <div className="lp-card-icon">{icon}</div>
              <h3>{t(`land.f.${k}.title`)}</h3>
              <p>{t(`land.f.${k}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="screens" className="lp-section lp-wrap">
        <h2 className="reveal">{t('land.screensTitle')}</h2>
        <p className="lp-sub reveal">{t('land.screensSub')}</p>
        {SHOWCASE.map((s, i) => (
          <div key={s.key} className={`lp-show ${i % 2 ? 'flip' : ''}`}>
            <div className="lp-show-text reveal">
              <span className="lp-kicker">{t(`land.s.${s.key}.kicker`)}</span>
              <h3>{t(`land.s.${s.key}.title`)}</h3>
              <p>{t(`land.s.${s.key}.text`)}</p>
              <ul>{[1, 2, 3].map((n) => <li key={n}>{t(`land.s.${s.key}.b${n}`)}</li>)}</ul>
            </div>
            <div className="lp-show-visual reveal">
              <Frame src={img(s.imgs[0])} alt={t(`land.s.${s.key}.title`)} onOpen={open} />
              <Frame src={img(s.imgs[1])} alt={t(`land.s.${s.key}.title`)} className="lp-second" onOpen={open} />
            </div>
          </div>
        ))}
      </section>

      <section id="ranking" className="lp-section lp-wrap lp-rank">
        <div className="lp-rank-text reveal">
          <span className="lp-kicker">{t('land.rankKicker')}</span>
          <h2>{t('land.rankTitle')}</h2>
          <p>{t('land.rankText')}</p>
          <Cta>{t('land.rankCta')}</Cta>
        </div>
        <div className="lp-rank-board reveal">
          <div className="lp-rank-head">🏆 {t('land.rankBoard')}</div>
          {top && top.length > 0 ? top.map((r, i) => (
            <div key={r.id} className="lp-rank-row"><b>{i + 1}</b><span>{r.name}<small>{r.club} · {r.league}</small></span><em>{r.points}</em></div>
          )) : (
            <div className="lp-rank-empty">{t('land.rankEmpty')}</div>
          )}
        </div>
      </section>

      <section className="lp-section lp-wrap">
        <h2 className="reveal">{t('land.stepsTitle')}</h2>
        <div className="lp-steps">
          {[1, 2, 3].map((n) => (
            <div key={n} className="lp-step reveal" style={{ transitionDelay: `${n * 90}ms` }}>
              <span>{n}</span><h3>{t(`land.step${n}.title`)}</h3><p>{t(`land.step${n}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="lp-section lp-wrap lp-faq">
        <h2 className="reveal">{t('land.faqTitle')}</h2>
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <details key={n} className="reveal">
            <summary>{t(`land.q${n}`)}</summary>
            <p>{t(`land.a${n}`)}</p>
          </details>
        ))}
      </section>

      <section className="lp-final">
        <div className="lp-wrap reveal">
          <h2>{t('land.finalTitle')}</h2>
          <p>{t('land.finalText')}</p>
          <Cta big />
        </div>
      </section>

      <div className="lp-support lp-wrap">
        <span>💛 {t('land.supportLine')}</span>
        <a className="link" href="?community=1">{t('land.community')}</a>
      </div>
      <footer className="lp-footer lp-wrap">
        <div>© {new Date().getFullYear()} TACTICA FC · {t('land.footerData')}</div>
        <div className="lp-disclaimer">{t('land.disclaimer')}</div>
      </footer>

      {lightbox && (
        <div className="lp-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label={lightbox.alt}>
          <img src={lightbox.src} alt={lightbox.alt} />
          <button className="lp-close" aria-label={t('common.close')}>×</button>
        </div>
      )}
    </div>
  );
}
