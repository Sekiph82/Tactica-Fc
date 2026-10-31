// Støt projektet: donation (Stripe), hvad pengene går til, supporterlisten og supporternes belønninger.
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { getProfile } from '../online/rank';
import { checkout, mySupport, nameRegen, refreshSupport, setBeta, supporters, type MySupport, type SupporterList, type Tier } from '../online/support';
import { Panel } from './components';

const AMOUNTS = [500, 1000, 2500, 5000];
const fmt = (cents: number, cur: string) => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: cur.toUpperCase(), maximumFractionDigits: 0 });

/** Supportermærke ved navnet (ranglister, profil, forslag, kommentarer) */
export function SupporterBadge({ tier }: { tier?: Tier | string | null }) {
  if (!tier) return null;
  const icon = tier === 'gold' ? '🥇' : tier === 'silver' ? '🥈' : '🥉';
  return <span className={`tag sup-${tier}`} title={t('sup.badgeHint')}>{icon} {t(`sup.tier.${tier}`)}</span>;
}

export function SupportPage() {
  const [me, setMe] = useState<MySupport | null>(mySupport());
  const [list, setList] = useState<SupporterList | null>(null);
  const [amount, setAmount] = useState(1000);
  const [monthly, setMonthly] = useState(false);
  const [msg, setMsg] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const prof = getProfile();
  const thanks = new URLSearchParams(location.search).get('support') === 'thanks';
  useEffect(() => { refreshSupport().then(setMe); supporters().then(setList); }, []);
  const cur = list?.currency ?? 'eur';
  const enabled = list?.enabled ?? me?.enabled ?? false;
  const pct = list ? Math.min(100, Math.round((list.month.raised / Math.max(1, list.month.goal)) * 100)) : 0;
  return (
    <div className="support">
      {thanks && <div className="insight good"><b>{t('sup.thanks')}</b> {t('sup.thanksText')}</div>}
      <div className="cols">
        <Panel title={t('sup.title')}>
          <p style={{ marginTop: 0, lineHeight: 1.55 }}>{t('sup.intro')}</p>
          {!enabled ? <div className="insight">{t('sup.soon')}</div> : !prof ? <div className="insight warn">{t('sup.needProfile')}</div> : (
            <>
              <div className="seg" style={{ marginBottom: 10 }}>
                <button className={!monthly ? 'on' : ''} onClick={() => setMonthly(false)}>{t('sup.once')}</button>
                <button className={monthly ? 'on' : ''} onClick={() => setMonthly(true)}>{t('sup.monthly')}</button>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {AMOUNTS.map((a) => <button key={a} className={amount === a ? 'primary' : ''} onClick={() => setAmount(a)}>{fmt(a, cur)}{monthly ? ` / ${t('sup.month')}` : ''}</button>)}
              </div>
              <button className="start-cta" style={{ marginTop: 12 }} onClick={async () => { setMsg(''); const e = await checkout(amount, monthly); if (e) setMsg(t(`sup.err.${e}`) === `sup.err.${e}` ? t('cm.err.error') : t(`sup.err.${e}`)); }}>
                {t('sup.give', { amount: fmt(amount, cur) })} <span>→</span>
              </button>
              <p className="muted" style={{ fontSize: 12.5 }}>{t('sup.secure')}</p>
            </>
          )}
          {msg && <div className="insight bad">{msg}</div>}
        </Panel>
        <Panel title={t('sup.where')}>
          {list && (
            <>
              <div className="sup-goal"><span style={{ width: `${pct}%` }} /></div>
              <p style={{ margin: '6px 0 10px' }}><b>{pct}%</b> {t('sup.goalText', { raised: fmt(list.month.raised, cur), goal: fmt(list.month.goal, cur) })}</p>
            </>
          )}
          <ul className="sup-costs">
            <li>🤖 <b>{t('sup.cost.ai')}</b> – {t('sup.cost.aiText')}</li>
            <li>🗄️ <b>{t('sup.cost.db')}</b> – {t('sup.cost.dbText')}</li>
            <li>🌐 <b>{t('sup.cost.host')}</b> – {t('sup.cost.hostText')}</li>
            <li>⚽ <b>{t('sup.cost.dev')}</b> – {t('sup.cost.devText')}</li>
          </ul>
        </Panel>
      </div>
      <Panel title={t('sup.rewards')}>
        <div className="sup-tiers">
          {(['bronze', 'silver', 'gold'] as const).map((tier) => (
            <div key={tier} className={`sup-tier sup-${tier} ${me?.tier === tier ? 'mine' : ''}`}>
              <b><SupporterBadge tier={tier} /></b>
              <span className="muted">{t(`sup.from.${tier}`, { amount: fmt(tier === 'gold' ? 6000 : tier === 'silver' ? 2500 : 500, cur) })}</span>
              <ul>{t(`sup.perks.${tier}`).split('|').map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12.5 }}>{t('sup.fair')}</p>
      </Panel>
      {me?.tier && (
        <div className="cols">
          <Panel title={t('sup.yourStatus')}>
            <div className="row" style={{ gap: 8 }}><SupporterBadge tier={me.tier} />{me.monthly && <span className="tag good">{t('sup.monthlyOn')}</span>}</div>
            <label className="row" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={me.beta} onChange={async (e) => { await setBeta(e.target.checked); setMe(await refreshSupport()); }} />
              {t('sup.beta')}
            </label>
            <div className="muted" style={{ fontSize: 12.5 }}>{t('sup.betaHint')}</div>
          </Panel>
          <Panel title={t('sup.regenTitle')}>
            {me.tier === 'bronze' ? <div className="muted">{t('sup.regenLocked')}</div> : (
              <>
                <p className="muted" style={{ marginTop: 0 }}>{t('sup.regenHint')}</p>
                {me.regen && <div className="insight good">{t('sup.regenNow', { name: me.regen })}</div>}
                <div className="row">
                  <input placeholder={t('sup.first')} maxLength={18} value={first} onChange={(e) => setFirst(e.target.value)} />
                  <input placeholder={t('sup.last')} maxLength={22} value={last} onChange={(e) => setLast(e.target.value)} />
                  <button className="primary" onClick={async () => { const r = await nameRegen(first, last); if (r.error) setMsg(t(`sup.err.${r.error}`)); else setMe(await refreshSupport()); }}>{t('prof.save')}</button>
                </div>
              </>
            )}
          </Panel>
        </div>
      )}
      <Panel title={t('sup.wall', { n: list?.supporters.length ?? 0 })}>
        {!list?.supporters.length ? <div className="muted">{t('sup.wallEmpty')}</div> : (
          <div className="sup-wall">
            {list.supporters.map((s) => <span key={s.pid} className={`sup-name sup-${s.tier ?? 'none'}`}>{s.tier === 'gold' ? '🥇' : s.tier === 'silver' ? '🥈' : '🥉'} {s.name}{s.monthly ? ' ♥' : ''}</span>)}
          </div>
        )}
      </Panel>
    </div>
  );
}
