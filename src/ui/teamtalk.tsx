// Holdsnak før kampen, i pausen og efter kampen – vælg tone, evt. individuelle beskeder, og se reaktionerne.
import { useMemo, useState } from 'react';
import { act } from '../game/actions';
import { INDIVIDUAL_TONES, MAX_INDIVIDUAL, TONES, assistantTone, matchExpectation, talkDone, type TalkResult } from '../game/teamtalk';
import type { TalkStage, TalkTone } from '../game/types';
import { t } from '../i18n';
import { Panel, PlayerLink } from './components';
import { useGame } from './core';
import { Select } from './select';

const REACTION_TONE: Record<string, string> = { fired: 'good', focused: 'good', neutral: '', complacent: 'warn', nervous: 'warn', angry: 'bad', deflated: 'bad' };

export function TeamTalk({ fixture, stage, pids, diff, ratings, onGiven }: {
  fixture: number;
  stage: TalkStage;
  pids: number[];
  diff: number;
  ratings: Record<number, number>;
  onGiven?: (boosts: Record<number, number>) => void;
}) {
  const g = useGame()!;
  const [tone, setTone] = useState<TalkTone | null>(null);
  const [ind, setInd] = useState<Record<number, TalkTone>>({});
  const [results, setResults] = useState<TalkResult[] | null>(null);
  const [showInd, setShowInd] = useState(false);
  const ex = useMemo(() => matchExpectation(fixture), [fixture]);
  const advice = useMemo(() => assistantTone({ stage, fixture, e: ex.e, big: ex.big, diff, ratings }, pids), [stage, fixture, ex, diff, ratings, pids]);
  const done = talkDone(fixture, stage);
  const situation = stage === 'pre'
    ? t(ex.e > 0.25 ? 'tt.sit.fav' : ex.e < -0.25 ? 'tt.sit.under' : 'tt.sit.even') + (ex.big ? ` ${t('tt.sit.big')}` : '')
    : t(diff > 0 ? 'tt.sit.lead' : diff < 0 ? 'tt.sit.behind' : 'tt.sit.level') + ` ${t(ex.e > 0.25 ? 'tt.sit.asFav' : ex.e < -0.25 ? 'tt.sit.asUnder' : 'tt.sit.asEven')}`;

  const give = () => {
    if (!tone) return;
    const r = act<{ results: TalkResult[]; boosts: Record<number, number> } | string>({ t: 'matchTalk', fixture, stage, tone, pids, diff, ratings, individual: ind });
    if (typeof r === 'string') return;
    setResults(r.results);
    onGiven?.(r.boosts);
  };

  if (results) {
    const count = (k: string) => results.filter((r) => r.reaction === k).length;
    const good = count('fired') + count('focused'), bad = results.length - good - count('neutral');
    return (
      <Panel title={t(`tt.title.${stage}`)}>
        <div className={`insight ${good > bad * 2 ? 'good' : bad > good ? 'bad' : 'warn'}`}>{t(good > bad * 2 ? 'tt.sum.good' : bad > good ? 'tt.sum.bad' : 'tt.sum.mixed', { good, bad })}</div>
        <div className="tt-reactions">
          {results.map((r) => (
            <div key={r.pid} className="tt-r">
              <PlayerLink p={g.players[r.pid]} short />
              {r.individual && <span className="muted"> ({t(`tt.ind.${r.individual}`)})</span>}
              <span className={`tag ${REACTION_TONE[r.reaction]}`}>{t(`tt.r.${r.reaction}`)}</span>
            </div>
          ))}
        </div>
      </Panel>
    );
  }
  if (done) return null;

  const indCount = Object.keys(ind).length;
  return (
    <Panel title={t(`tt.title.${stage}`)}>
      <div className="muted" style={{ marginBottom: 8 }}>{situation}</div>
      <div className="tt-tones">
        {TONES[stage].map((k) => (
          <button key={k} className={`tt-tone ${tone === k ? 'on' : ''}`} onClick={() => setTone(k)}>
            <b>{t(`tt.tone.${k}`)}</b>
            <span className="muted">{t(`tt.say.${stage}.${k}`)}</span>
            {k === advice && <span className="tag good">{t('tt.advice')}</span>}
          </button>
        ))}
      </div>
      {!showInd ? (
        <div className="row tt-actions">
          <button className="small" onClick={() => setShowInd(true)}>+ {t('tt.individual', { n: MAX_INDIVIDUAL })}</button>
          <button className="primary small" disabled={!tone} onClick={give}>{t('tt.give')}</button>
        </div>
      ) : (
        <div className="tt-ind">
          <div className="muted" style={{ fontSize: 12 }}>{t('tt.individualHint', { n: MAX_INDIVIDUAL })}</div>
          {pids.map((pid) => {
            const p = g.players[pid];
            if (!p) return null;
            const cur = ind[pid];
            return (
              <div key={pid} className="row tt-ind-row">
                <span className="grow"><PlayerLink p={p} short />{ratings[pid] !== undefined && <span className="muted"> · {ratings[pid].toFixed(1)}</span>}</span>
                <Select<string> value={cur ?? ''} width={170}
                  options={[{ value: '', label: t('tt.ind.none') }, ...INDIVIDUAL_TONES.map((k) => ({ value: k, label: t(`tt.ind.${k}`) }))]}
                  onChange={(v) => {
                    const next = { ...ind };
                    if (!v) delete next[pid];
                    else if (cur || indCount < MAX_INDIVIDUAL) next[pid] = v as TalkTone;
                    setInd(next);
                  }} />
              </div>
            );
          })}
        </div>
      )}
      {showInd && (
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
          <button className="primary small" disabled={!tone} onClick={give}>{t('tt.give')}</button>
        </div>
      )}
    </Panel>
  );
}
