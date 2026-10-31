// Min profil: billede, navn, nationalitet og motto – plus præstationer og den offentlige profil, der kan deles.
import { mySupport } from '../../online/support';
import { SupporterBadge } from '../Support';
import { useEffect, useMemo, useState } from 'react';
import { act } from '../../game/actions';
import { natName, t } from '../../i18n';
import { getProfile, profileUrl, rankingAvailable, renameProfile, syncProfile } from '../../online/rank';
import { AchievementsGrid } from '../Achievements';
import { getAvatar, lastAvatar, resizeImage, setAvatar } from '../avatar';
import { Flag, Panel } from '../components';
import { useGame } from '../core';
import { Select } from '../select';
import { Head } from './common';

export function ProfileScreen() {
  const g = useGame()!;
  const prof = getProfile();
  const [name, setName] = useState(g.manager.name);
  const [nation, setNation] = useState(g.manager.nation);
  const [motto, setMotto] = useState(g.manager.motto ?? '');
  const [avatar, setAv] = useState(getAvatar());
  const [msg, setMsg] = useState<{ text: string; tone: string } | null>(null);
  const nations = useMemo(() => g.nations.map((n, i) => ({ value: i, label: natName(n.name), flag: n.name })).sort((a, b) => a.label.localeCompare(b.label)), [g]);
  useEffect(() => { void syncProfile(); }, []);

  const pick = async (file?: File) => {
    if (!file) return;
    try { const url = await resizeImage(file); setAvatar(url); setAv(url); void syncProfile(); } catch { setMsg({ text: t('prof.imgError'), tone: 'bad' }); }
  };
  const save = async () => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (clean.length < 2) { setMsg({ text: t('prof.nameShort'), tone: 'bad' }); return; }
    act({ t: 'managerProfile', name: clean, nation, motto });
    let text = t('prof.saved'), tone = 'good';
    // navnet på ranglisterne følger med (hvis man har en profil dér)
    if (prof && clean !== prof.name) {
      const r = await renameProfile(clean.slice(0, 24));
      if (r !== 'ok' && r !== 'none') { text = t('prof.savedRankFail', { err: t(`rank.err.${r}`) }); tone = 'warn'; }
    }
    void syncProfile();
    setMsg({ text, tone });
  };
  const share = async () => {
    if (!prof) return;
    const url = profileUrl(prof.pid);
    try {
      if (navigator.share) await navigator.share({ title: `${g.manager.name} – TACTICA FC`, url });
      else { await navigator.clipboard.writeText(url); setMsg({ text: t('rank.copied'), tone: '' }); }
    } catch { /* afbrudt */ }
  };
  const initials = g.manager.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  const trophies = g.manager.trophies.filter((x) => !/month/.test(x.comp));
  return (
    <div>
      <Head title={t('nav.profile')} />
      <div className="cols">
        <Panel title={t('prof.edit')}>
          <div className="prof-edit">
            <label className="prof-avatar" title={t('prof.upload')}>
              {avatar ? <img src={avatar} alt="" /> : <span>{initials}</span>}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
              <em>{t('prof.change')}</em>
            </label>
            <div className="col" style={{ flex: 1, minWidth: 0 }}>
              <label className="prof-field">{t('prof.name')}<input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} /></label>
              <label className="prof-field">{t('prof.nation')}<Select value={nation} onChange={setNation} options={nations} width={240} /></label>
              <label className="prof-field">{t('prof.motto')}<textarea value={motto} maxLength={140} rows={2} placeholder={t('prof.mottoPh')} onChange={(e) => setMotto(e.target.value)} /></label>
              <div className="row">
                <button className="primary" onClick={save}>{t('prof.save')}</button>
                {avatar && <button className="small" onClick={() => { setAvatar(''); setAv(''); void syncProfile(); }}>{t('prof.removeImg')}</button>}
                {!avatar && lastAvatar() && <button className="small" onClick={() => { const a = lastAvatar(); setAvatar(a); setAv(a); void syncProfile(); }}>{t('prof.useLast')}</button>}
              </div>
              {msg && <div className={`insight ${msg.tone}`}>{msg.text}</div>}
            </div>
          </div>
        </Panel>
        <Panel title={t('prof.card')}>
          <div className="prof-card">
            <div className="pub-avatar">{avatar ? <img src={avatar} alt="" /> : initials}</div>
            <div>
              <b className="prof-card-name">{g.manager.name}</b> <SupporterBadge tier={mySupport()?.tier} />
              <div className="muted"><Flag name={g.nations[g.manager.nation]?.name} />{natName(g.nations[g.manager.nation]?.name)}</div>
              {g.manager.motto && <div className="prof-motto">“{g.manager.motto}”</div>}
            </div>
          </div>
          <div className="pub-stats prof-stats">
            <div><b>{new Set(g.manager.history.map((h) => h.season)).size}</b><span>{t('pub.seasons')}</span></div>
            <div><b>{g.manager.achStats?.wins ?? 0}</b><span>{t('pub.wins')}</span></div>
            <div><b>{trophies.length}</b><span>{t('pub.trophies')}</span></div>
            <div><b>{Math.round(g.manager.rep)}</b><span>{t('pub.rep')}</span></div>
          </div>
          {!rankingAvailable() ? <div className="muted">{t('rank.offline')}</div> : !prof ? <div className="muted">{t('pub.needProfile')}</div> : (
            <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
              <button className="primary" onClick={share}>{t('pub.share')}</button>
              <button onClick={() => window.open(profileUrl(prof.pid), '_blank')}>{t('pub.open')}</button>
            </div>
          )}
          <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>{t('pub.hint')}</p>
        </Panel>
      </div>
      <Panel title={t('ach.panel')}><AchievementsGrid unlocked={g.manager.ach ?? {}} /></Panel>
    </div>
  );
}
