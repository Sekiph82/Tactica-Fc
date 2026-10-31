// Præstationer (gitter) og den offentlige managerprofil, der kan deles med et link.
import { SupporterBadge } from './Support';
import { useEffect, useState } from 'react';
import { ACHIEVEMENTS } from '../game/achievements';
import { dateFmt, natName, t } from '../i18n';
import { fetchProfile, type PublicProfile } from '../online/rank';
import { Flag } from './components';

/** Alle præstationer: låst op (med dato) eller låst */
export function AchievementsGrid({ unlocked }: { unlocked: Record<string, string | true> }) {
  const n = ACHIEVEMENTS.filter((a) => unlocked[a.id]).length;
  return (
    <div>
      <div className="ach-progress"><span style={{ width: `${(n / ACHIEVEMENTS.length) * 100}%` }} /></div>
      <div className="muted" style={{ fontSize: 12.5, margin: '4px 0 12px' }}>{t('ach.count', { n, total: ACHIEVEMENTS.length })}</div>
      <div className="ach-grid">
        {ACHIEVEMENTS.map((a) => {
          const at = unlocked[a.id];
          return (
            <div key={a.id} className={`ach ${at ? 'on' : ''} tier${a.tier}`} title={t(`ach.${a.id}.desc`)}>
              <span className="ach-icon">{at ? a.icon : '🔒'}</span>
              <div>
                <b>{t(`ach.${a.id}`)}</b>
                <span>{t(`ach.${a.id}.desc`)}</span>
                <small>{at ? (typeof at === 'string' ? dateFmt(at) : t(`ach.tier${a.tier}`)) : t('ach.locked')}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Den offentlige profil (åbnes med ?manager=<id>) */
export function PublicProfilePage({ pid, onClose }: { pid: string; onClose: () => void }) {
  const [p, setP] = useState<PublicProfile | null | 'loading'>('loading');
  useEffect(() => { fetchProfile(pid).then(setP); }, [pid]);
  return (
    <div className="pub">
      <div className="start-aurora" aria-hidden><i /><i /><i /></div>
      <div className="pub-box">
        <button className="small start-ghost" onClick={onClose}>← TACTICA FC</button>
        {p === 'loading' ? <div className="muted" style={{ marginTop: 40 }}>{t('pub.loading')}</div> : !p ? <div className="muted" style={{ marginTop: 40 }}>{t('pub.notFound')}</div> : (
          <>
            <div className="pub-head">
              <div className="pub-avatar">{p.avatar ? <img src={p.avatar} alt="" /> : p.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div>
                <h1>{p.name} <SupporterBadge tier={p.supporter} /></h1>
                {p.regen && <div className="muted">⭐ {t('sup.regenNamed', { name: p.regen })}</div>}
                <div className="muted">{p.summary?.nation ? <><Flag name={p.summary.nation} />{natName(p.summary.nation)} · </> : ''}{t('pub.since', { date: dateFmt(p.created.slice(0, 10)) })}</div>
                {p.motto && <div className="prof-motto">“{p.motto}”</div>}
                {p.motto && <div className="prof-motto">“{p.motto}”</div>}
                {p.summary?.club && <div className="pub-club">{t('pub.now', { club: p.summary.club, league: p.summary.league })}</div>}
              </div>
            </div>
            {p.summary && (
              <div className="pub-stats">
                <div><b>{p.summary.seasons}</b><span>{t('pub.seasons')}</span></div>
                <div><b>{p.summary.wins}</b><span>{t('pub.wins')}</span></div>
                <div><b>{p.summary.titles}</b><span>{t('pub.trophies')}</span></div>
                <div><b>{p.summary.rep}</b><span>{t('pub.rep')}</span></div>
                <div><b>{p.careers[0]?.rank ? `#${p.careers[0].rank}` : '–'}</b><span>{t('pub.rank')}</span></div>
              </div>
            )}
            {p.summary && p.summary.trophyList.length > 0 && (
              <section><h2>{t('pub.trophyList')}</h2><div className="row">{p.summary.trophyList.slice().reverse().map((x, i) => <span key={i} className="tag good">🏆 {x}</span>)}</div></section>
            )}
            {p.careers.length > 0 && (
              <section>
                <h2>{t('pub.careers')}</h2>
                <table className="grid"><tbody>{p.careers.map((c) => <tr key={c.id}><td>{c.club}</td><td className="muted">{c.league}</td><td className="num">{t('pub.seasonsN', { n: c.seasons })}</td><td className="num"><b>{c.total}</b> {t('pub.pts')}</td><td className="num muted">{c.rank ? `#${c.rank}` : ''}</td></tr>)}</tbody></table>
              </section>
            )}
            <section><h2>{t('ach.panel')}</h2><AchievementsGrid unlocked={Object.fromEntries(p.ach.map((a) => [a, true as const]))} /></section>
            <div style={{ textAlign: 'center', marginTop: 24 }}><button className="start-cta" onClick={onClose}>{t('pub.play')} <span>→</span></button></div>
          </>
        )}
      </div>
    </div>
  );
}
