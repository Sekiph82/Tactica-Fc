import { useState } from 'react';
import { isSupporter } from '../../online/support';
import { exportSave, saveGame } from '../../game/save';
import { notify } from '../../game/state';
import { act } from '../../game/actions';
import { session } from '../../online/client';
import { CURRENCIES, getCurrency, getLang, setCurrency, setLang, t, type Currency } from '../../i18n';
import type { Lang } from '../../game/types';
import { Panel } from '../components';
import { useGame } from '../core';
import { Head } from './common';
import { getTheme, setTheme, type Theme } from '../theme';
import { notifyEnabled, notifySupported, setNotify } from '../notify';

export function Options() {
  const g = useGame()!;
  const [msg, setMsg] = useState('');
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [notif, setNotif] = useState(notifyEnabled());
  return (
    <div>
      <Head title={t('nav.options')} />
      <div className="cols">
        <Panel title={t('opt.general')}>
          <div className="col">
            <label className="row">{t('opt.language')}
              <select value={getLang()} onChange={(e) => { setLang(e.target.value as Lang); g.lang = e.target.value as Lang; notify(); }}>
                <option value="da">Dansk</option><option value="en">English</option><option value="tr">Türkçe</option>
              </select>
            </label>
            <label className="row">{t('opt.currency')}
              <select value={getCurrency()} onChange={(e) => { setCurrency(e.target.value as Currency); notify(); }}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{t(`cur.${c}`)}</option>)}
              </select>
            </label>
            <label className="row">{t('opt.autosave')}
              <select value={g.options.autosaveMode ?? (g.options.autosave === false ? 'off' : 'changes')} onChange={(e) => { g.options.autosaveMode = e.target.value as 'changes'; g.options.autosave = e.target.value !== 'off'; notify(); }}>
                {(['changes', 'daily', 'weekly', 'monthly', 'off'] as const).map((m) => <option key={m} value={m}>{t(`opt.save.${m}`)}</option>)}
              </select>
            </label>
            <div className="muted">{t(`opt.save.${g.options.autosaveMode ?? 'changes'}.hint`)}</div>
            <label className="row">{t('opt.theme')}
              <select value={theme} onChange={(e) => { setThemeState(e.target.value as Theme); setTheme(e.target.value as Theme); }}>
                {(['club', 'clubDark', 'light', 'dark'] as const).map((m) => <option key={m} value={m}>{t(`opt.theme.${m}`)}</option>)}
                {(['gold', 'retro'] as const).map((m) => <option key={m} value={m} disabled={!isSupporter()}>{t(`opt.theme.${m}`)}{isSupporter() ? '' : ` (${t('sup.supportersOnly')})`}</option>)}
              </select>
            </label>
            {(theme === 'club' || theme === 'clubDark') && <div className="muted">{t('opt.theme.clubHint')}</div>}
            {notifySupported() && <label className="row"><input type="checkbox" checked={notif} onChange={async (e) => setNotif(await setNotify(e.target.checked))} />{t('opt.notify')}</label>}
            {notifySupported() && <div className="muted">{t('opt.notify.hint')}</div>}
            <div className="muted">{t('opt.newsMoved')}</div>
            {g.humans && (
              <label className="row">{t('opt.h2hTime')}
                <select value={g.options.h2hHalfMinutes ?? 3} disabled={!session()?.isHost} title={!session()?.isHost ? t('opt.hostOnly') : undefined}
                  onChange={(e) => act({ t: 'setH2hTime', minutes: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 7, 10].map((m) => <option key={m} value={m}>{t('opt.h2hMin', { n: m })}</option>)}
                </select>
              </label>
            )}
            {!g.draft && <>
            <label className="row">{t('opt.rules')}
              <select value={g.options.rules ?? 'modern'} disabled={!!g.humans && !session()?.isHost} title={g.humans && !session()?.isHost ? t('opt.hostOnly') : undefined}
                onChange={(e) => act({ t: 'setRules', rules: e.target.value as 'modern' | 'classic' })}>
                {(['modern', 'classic'] as const).map((m) => <option key={m} value={m}>{t(`opt.rules.${m}`)}</option>)}
              </select>
            </label>
            <div className="muted">{t('opt.rules.hint')}</div>
            <label className="row">{t('opt.windows')}
              <select value={g.options.transferWindows ?? 'real'} disabled={!!g.humans && !session()?.isHost} title={g.humans && !session()?.isHost ? t('opt.hostOnly') : undefined}
                onChange={(e) => { act({ t: 'setWindows', mode: e.target.value as 'real' | 'classic' }); }}>
                {(['real', 'classic'] as const).map((m) => <option key={m} value={m}>{t(`opt.windows.${m}`)}</option>)}
              </select>
            </label>
            </>}
            <label className="row"><input type="checkbox" checked={g.options.ai !== false} onChange={(e) => { g.options.ai = e.target.checked; notify(); }} />{t('opt.ai')}</label>
            <div className="muted">{t('opt.ai.hint')}</div>
            {!g.draft && <label className="row"><input type="checkbox" checked={g.options.masking} onChange={(e) => { g.options.masking = e.target.checked; notify(); }} />{t('start.masking')}</label>}
            <label className="col">{t('opt.speed')}
              <input type="range" min={60} max={1500} step={20} value={1560 - g.options.matchSpeed} onChange={(e) => { g.options.matchSpeed = 1560 - Number(e.target.value); notify(); }} />
            </label>
          </div>
        </Panel>
        <Panel title={t('opt.saves')}>
          <div className="col">
            <button onClick={async () => { await saveGame(); setMsg(t('top.saved')); }}>{t('nav.save')}</button>
            <button onClick={() => exportSave()}>{t('opt.export')}</button>
            <div className="muted">{t('opt.exportHint')}</div>
            <div className="kv"><span>{t('start.seed')}</span><span>{g.seed}</span></div>
            {msg && <div className="good">{msg}</div>}
          </div>
        </Panel>
        <Panel title={t('opt.about')}>
          <p>{t('opt.aboutText')}</p>
          <p className="muted">{t('opt.dataCredit')}</p>
        </Panel>
      </div>
    </div>
  );
}
