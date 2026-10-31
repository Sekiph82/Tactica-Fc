// Tilskuere, faciliteter og økonomihistorik – fanerne på økonomisiden.
import { act } from '../../game/actions';
import { projectOffer } from '../../game/board';
import { estimateGate, wantedAttendance } from '../../game/finance';
import type { Club, Fixture, ProjectKind, SeasonFinance } from '../../game/types';
import { dateFmt, money, t } from '../../i18n';
import { ClubLink, Panel } from '../components';
import { useGame } from '../core';
import { gs } from '../../game/state';

interface HomeGame { f: Fixture; att: number; gate: number; opp: number; comp: string }

/** Klubbens hjemmekampe denne sæson med tilskuere */
function homeGames(clubId: number): HomeGame[] {
  const g = gs();
  return Object.values(g.fixtures)
    .filter((f) => f.home === clubId && f.result?.att)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((f) => ({ f, att: f.result!.att!, gate: f.result!.gate ?? 0, opp: f.away, comp: g.comps[f.comp]?.name ?? '' }));
}

/** Ligaens klubber med gennemsnitligt tilskuertal i ligakampe denne sæson */
function leagueAttendance(league: string): { club: Club; avg: number; fill: number; n: number }[] {
  const g = gs();
  const comp = g.comps[league];
  if (!comp) return [];
  const sums = new Map<number, { sum: number; n: number }>();
  for (const f of Object.values(g.fixtures)) {
    if (f.comp !== league || !f.result?.att) continue;
    const e = sums.get(f.home) ?? { sum: 0, n: 0 };
    e.sum += f.result.att;
    e.n++;
    sums.set(f.home, e);
  }
  return comp.clubs.map((id) => {
    const club = g.clubs[id];
    const e = sums.get(id);
    const avg = e ? e.sum / e.n : estimateGate(club, club.ticketPrice).attendance;
    return { club, avg: Math.round(avg), fill: avg / club.seats, n: e?.n ?? 0 };
  }).sort((a, b) => b.avg - a.avg);
}

// ---------- tilskuere ----------

export function AttendanceTab({ ticketPanel }: { ticketPanel: React.ReactNode }) {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const games = homeGames(c.id);
  const n = games.length;
  const avg = n ? Math.round(games.reduce((s, x) => s + x.att, 0) / n) : 0;
  const best = games.reduce<HomeGame | null>((a, b) => (!a || b.att > a.att ? b : a), null);
  const worst = games.reduce<HomeGame | null>((a, b) => (!a || b.att < a.att ? b : a), null);
  const sellouts = games.filter((x) => x.att >= c.seats * 0.98).length;
  const gate = games.reduce((s, x) => s + x.gate, 0);
  const league = leagueAttendance(c.league);
  const rank = league.findIndex((r) => r.club.id === c.id) + 1;
  const leagueAvg = league.length ? Math.round(league.reduce((s, r) => s + r.avg, 0) / league.length) : 0;
  const prev = c.history.at(-1)?.fin;
  return (
    <div className="col">
      <div className="kpis">
        <Kpi label={t('att.avgAll')} value={avg ? avg.toLocaleString() : '–'} sub={prev?.avgAtt ? t('att.lastSeason', { n: prev.avgAtt.toLocaleString() }) : t('att.leagueAvg', { n: leagueAvg.toLocaleString() })} />
        <Kpi label={t('att.fill')} value={avg ? `${Math.round((avg / c.seats) * 100)}%` : '–'} sub={t('att.capacity', { n: c.seats.toLocaleString() })} />
        <Kpi label={t('att.rank')} value={rank ? `${rank}.` : '–'} sub={t('att.ofLeague', { n: league.length })} />
        <Kpi label={t('att.sellouts')} value={`${sellouts} / ${n}`} sub={t('att.homeGames')} />
        <Kpi label={t('att.gate')} value={money(gate)} sub={n ? t('att.perGame', { v: money(gate / n) }) : ''} />
      </div>
      <div className="cols">
        <Panel title={t('att.games')}>
          {n === 0 ? <div className="muted">{t('att.none')}</div> : (
            <>
              <AttendanceChart games={games} seats={c.seats} />
              <div className="kv" style={{ marginTop: 8 }}>
                {best && <><span>{t('att.best')}</span><span>{best.att.toLocaleString()} – <ClubLink id={best.opp} /> ({dateFmt(best.f.date)})</span></>}
                {worst && <><span>{t('att.worst')}</span><span>{worst.att.toLocaleString()} – <ClubLink id={worst.opp} /> ({dateFmt(worst.f.date)})</span></>}
              </div>
              <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="grid">
                <thead><tr><th>{t('col.date')}</th><th>{t('att.opp')}</th><th>{t('col.comp')}</th><th className="num">{t('ticket.att')}</th><th className="num">{t('ticket.fill')}</th><th className="num">{t('att.income')}</th></tr></thead>
                <tbody>
                  {games.slice().reverse().map((x) => (
                    <tr key={x.f.id}>
                      <td>{dateFmt(x.f.date)}</td>
                      <td><ClubLink id={x.opp} /></td>
                      <td className="muted">{x.comp}</td>
                      <td className="num">{x.att.toLocaleString()}</td>
                      <td className="num">{Math.round((x.att / c.seats) * 100)}%</td>
                      <td className="num">{money(x.gate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </Panel>
        <Panel title={t('att.league')} className="flush">
          <table className="grid">
            <thead><tr><th>#</th><th>{t('col.club')}</th><th className="num">{t('att.capacityCol')}</th><th className="num">{t('att.avgCol')}</th><th className="num">{t('ticket.fill')}</th></tr></thead>
            <tbody>
              {league.map((r, i) => (
                <tr key={r.club.id} className={r.club.id === c.id ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td><ClubLink id={r.club.id} /></td>
                  <td className="num">{r.club.seats.toLocaleString()}</td>
                  <td className="num">{r.avg.toLocaleString()}{r.n === 0 ? '*' : ''}</td>
                  <td className="num">{Math.min(100, Math.round(r.fill * 100))}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {league.some((r) => r.n === 0) && <div className="muted" style={{ padding: '6px 12px', fontSize: 12 }}>{t('att.estimated')}</div>}
        </Panel>
      </div>
      {ticketPanel}
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <b className="kpi-value">{value}</b>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

/** Søjlediagram: tilskuere pr. hjemmekamp i forhold til kapaciteten */
function AttendanceChart({ games, seats }: { games: HomeGame[]; seats: number }) {
  const g = useGame()!;
  const w = 100 / Math.max(games.length, 1);
  return (
    <div className="att-chart" role="img" aria-label={t('att.games')}>
      {games.map((x) => {
        const pct = Math.min(1, x.att / seats);
        return (
          <div key={x.f.id} className="att-col" style={{ width: `${w}%` }} title={`${dateFmt(x.f.date)} · ${g.clubs[x.opp]?.name ?? ''} · ${x.att.toLocaleString()} (${Math.round(pct * 100)}%) · ${money(x.gate)}`}>
            <div className={`att-bar ${pct >= 0.98 ? 'full' : pct < 0.6 ? 'low' : ''}`} style={{ height: `${Math.max(3, pct * 100)}%` }} />
          </div>
        );
      })}
      <div className="att-cap">{t('att.capacity', { n: seats.toLocaleString() })}</div>
    </div>
  );
}

// ---------- faciliteter ----------

const PROJECT_KINDS: ProjectKind[] = ['stadium', 'training', 'youth'];

export function FacilitiesTab() {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const comp = g.comps[c.league];
  const peers = (comp?.clubs ?? [c.id]).map((id) => g.clubs[id]).filter(Boolean);
  const rankOf = (v: (x: Club) => number) => peers.filter((x) => v(x) > v(c)).length + 1;
  const avgOf = (v: (x: Club) => number) => peers.reduce((s, x) => s + v(x), 0) / Math.max(1, peers.length);
  const bestOf = (v: (x: Club) => number) => peers.reduce((a, b) => (v(b) > v(a) ? b : a), c);

  // stadion: efterspørgsel uden kapacitetsloft → er en udvidelse pengene værd?
  const wanted = wantedAttendance(c, c.ticketPrice);
  // hjemmekampe i ligaen denne sæson (fra kampprogrammet)
  const homeGamesPerSeason = Math.max(1, Object.values(g.fixtures).filter((f) => f.comp === c.league && f.home === c.id).length || (comp?.clubs.length ?? 20) - 1);
  const stadiumOffer = projectOffer('stadium');
  const extraFans = stadiumOffer ? Math.max(0, Math.min(stadiumOffer.amount, wanted - c.seats)) : 0;
  const extraPerSeason = extraFans * c.ticketPrice * homeGamesPerSeason;
  const payback = stadiumOffer && extraPerSeason > 0 ? stadiumOffer.cost / extraPerSeason : null;

  // træning: samme faktor som træningsmodellen (0,75 + 0,25 × niveau/20), sammenlignet med middel (10)
  const trainEffect = Math.round(((0.75 + 0.25 * (c.facilities / 20)) / 0.875 - 1) * 100);
  // ungdom: vægter 60 % af årgangens kvalitet (resten er klubbens omdømme)
  const youthQ = (c.youth / 20) * 0.6 + (c.rep / 100) * 0.4;
  const youthLabel = youthQ >= 0.75 ? 'excellent' : youthQ >= 0.55 ? 'good' : youthQ >= 0.35 ? 'average' : 'poor';

  const facts: Record<ProjectKind, { level: string; rank: number; avg: string; best: Club; effect: string; advice?: string; tone?: string }> = {
    stadium: {
      level: c.seats.toLocaleString(), rank: rankOf((x) => x.seats), avg: Math.round(avgOf((x) => x.seats)).toLocaleString(), best: bestOf((x) => x.seats),
      effect: t('fac.stadium.effect', { wanted: wanted.toLocaleString(), seats: c.seats.toLocaleString() }),
      advice: wanted <= c.seats * 0.95 ? t('fac.stadium.notFull', { pct: Math.round((wanted / c.seats) * 100) })
        : payback !== null ? t('fac.stadium.payback', { years: payback.toFixed(1), extra: money(extraPerSeason) }) : undefined,
      tone: wanted <= c.seats * 0.95 ? 'warn' : payback !== null && payback <= 6 ? 'good' : '',
    },
    training: {
      level: `${c.facilities}/20`, rank: rankOf((x) => x.facilities), avg: avgOf((x) => x.facilities).toFixed(1), best: bestOf((x) => x.facilities),
      effect: t(trainEffect >= 0 ? 'fac.training.effectPlus' : 'fac.training.effectMinus', { pct: Math.abs(trainEffect) }),
    },
    youth: {
      level: `${c.youth}/20`, rank: rankOf((x) => x.youth), avg: avgOf((x) => x.youth).toFixed(1), best: bestOf((x) => x.youth),
      effect: t(`fac.youth.effect.${youthLabel}`),
    },
  };

  return (
    <div className="col">
      <div className="fac-grid">
        {PROJECT_KINDS.map((k) => {
          const fct = facts[k];
          const running = c.projects?.find((p) => p.kind === k);
          const offer = projectOffer(k);
          return (
            <Panel key={k} title={t(`proj.${k}`)}>
              <div className="fac-level"><b>{fct.level}</b><span className="muted">{t('fac.rank', { rank: fct.rank, n: peers.length })}</span></div>
              <div className="kv">
                <span>{t('fac.leagueAvg')}</span><span>{fct.avg}</span>
                <span>{t('fac.leagueBest')}</span><span><ClubLink id={fct.best.id} /></span>
              </div>
              <p className="fac-effect">{fct.effect}</p>
              <p className="muted fac-effect">{t(`proj.${k}.effect`)}</p>
              {fct.advice && <div className={`insight ${fct.tone ?? ''}`}>{fct.advice}</div>}
              {running ? (
                <div className="insight warn"><b>{t('proj.building')}</b> · {t('proj.ready', { date: dateFmt(running.done) })} · +{running.amount.toLocaleString()}{k === 'stadium' ? ` ${t('proj.seats')}` : ` ${t('proj.levels')}`}</div>
              ) : offer ? (
                <div className="fac-offer">
                  <div>+{offer.amount.toLocaleString()}{k === 'stadium' ? ` ${t('proj.seats')}` : ` ${t('proj.levels')}`} · <b>{money(offer.cost)}</b> · {t('proj.months', { n: offer.months })}</div>
                  <button className="small primary" disabled={c.balance < offer.cost} onClick={() => act({ t: 'project', kind: k })}>{t('proj.request')}</button>
                  {c.balance < offer.cost && <span className="muted">{t('proj.cantAfford')}</span>}
                </div>
              ) : <span className="muted">{t('proj.max')}</span>}
            </Panel>
          );
        })}
      </div>
      <div className="muted">{t('proj.hint')}</div>
    </div>
  );
}

// ---------- historik ----------

export function FinanceHistoryTab() {
  const g = useGame()!;
  const c = g.clubs[g.userClub];
  const f = c.finance;
  const games = homeGames(c.id).filter((x) => g.comps[x.f.comp]?.type === 'league');
  const now: SeasonFinance = {
    gate: f.gate, tv: f.tv, sponsor: f.sponsor, merch: f.merch, prize: f.prize, wages: f.wages, sales: f.transfersIn, buys: f.transfersOut, other: f.other,
    avgAtt: games.length ? Math.round(games.reduce((s, x) => s + x.att, 0) / games.length) : 0, seats: c.seats, homeGames: games.length, ticket: c.ticketPrice, balance: c.balance,
  };
  const rows: { season: number; pos?: number; league?: string; fin: SeasonFinance; live?: boolean }[] = [
    { season: g.season, fin: now, live: true },
    ...c.history.filter((h) => h.fin).slice().reverse().map((h) => ({ season: h.season, pos: h.pos, league: g.comps[h.league]?.name ?? g.leagues[h.league]?.name ?? h.league, fin: h.fin! })),
  ];
  const income = (x: SeasonFinance) => x.gate + x.tv + x.sponsor + x.merch + x.prize + x.sales;
  const expense = (x: SeasonFinance) => x.wages + x.buys + x.other;
  const maxIncome = Math.max(1, ...rows.map((r) => income(r.fin)));
  return (
    <div className="col">
      <Panel title={t('hist.incomeMix')}>
        <div className="mix-legend">
          {(['gate', 'tv', 'sponsor', 'merch', 'prize', 'sales'] as const).map((k) => <span key={k}><i className={`mix-${k}`} />{t(`fin.${k === 'sales' ? 'sales' : k}`)}</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.season} className="mix-row">
            <span className="mix-label">{r.season}/{String(r.season + 1).slice(2)}{r.live ? '*' : ''}</span>
            <div className="mix-bar" style={{ width: `${(income(r.fin) / maxIncome) * 100}%` }}>
              {(['gate', 'tv', 'sponsor', 'merch', 'prize', 'sales'] as const).map((k) => r.fin[k] > 0 && (
                <i key={k} className={`mix-${k}`} style={{ flex: r.fin[k] }} title={`${t(`fin.${k}`)}: ${money(r.fin[k])}`} />
              ))}
            </div>
            <span className="mix-total">{money(income(r.fin))}</span>
          </div>
        ))}
        <div className="muted" style={{ fontSize: 12 }}>{t('hist.liveNote')}</div>
      </Panel>
      <Panel title={t('hist.seasons')} className="flush">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                <th>{t('hist.season')}</th><th className="num">{t('hist.pos')}</th><th className="num">{t('att.avgCol')}</th><th className="num">{t('ticket.fill')}</th>
                <th className="num">{t('fin.gate')}</th><th className="num">{t('fin.tv')}</th><th className="num">{t('fin.sponsor')}</th><th className="num">{t('fin.merch')}</th><th className="num">{t('fin.prize')}</th>
                <th className="num">{t('fin.wages')}</th><th className="num">{t('hist.transfers')}</th><th className="num">{t('hist.result')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const res = income(r.fin) - expense(r.fin);
                return (
                  <tr key={r.season} className={r.live ? 'me' : ''}>
                    <td>{r.season}/{String(r.season + 1).slice(2)}{r.live ? '*' : ''}{r.league ? <span className="muted"> · {r.league}</span> : null}</td>
                    <td className="num">{r.pos ?? '–'}</td>
                    <td className="num">{r.fin.avgAtt ? r.fin.avgAtt.toLocaleString() : '–'}</td>
                    <td className="num">{r.fin.avgAtt ? `${Math.round((r.fin.avgAtt / r.fin.seats) * 100)}%` : '–'}</td>
                    <td className="num">{money(r.fin.gate)}</td>
                    <td className="num">{money(r.fin.tv)}</td>
                    <td className="num">{money(r.fin.sponsor)}</td>
                    <td className="num">{money(r.fin.merch)}</td>
                    <td className="num">{money(r.fin.prize)}</td>
                    <td className="num bad">{money(r.fin.wages)}</td>
                    <td className={`num ${r.fin.sales - r.fin.buys >= 0 ? 'good' : 'bad'}`}>{money(r.fin.sales - r.fin.buys)}</td>
                    <td className={`num ${res >= 0 ? 'good' : 'bad'}`}><b>{money(res)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 1 && <div className="muted" style={{ padding: '6px 12px', fontSize: 12 }}>{t('hist.first')}</div>}
      </Panel>
    </div>
  );
}
