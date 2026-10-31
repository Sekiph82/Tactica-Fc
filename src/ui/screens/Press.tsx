import { useEffect, useRef, useState } from 'react';
import { Info } from '../help';
import { act } from '../../game/actions';
import { effectsOf, followUpFor, toneOf, tonesFor, type PressConf, type PressTopic, type Tone } from '../../game/press';
import { leagueRows } from '../../game/competitions';
import { aiCall, aiText, setAiText } from '../../ai/client';
import { has, t } from '../../i18n';
import { Bar, Panel, AiSpinner } from '../components';
import { useGame, useNav } from '../core';
import { useAiAvailable } from '../ai';
import { Head } from './common';

const hashN = (s: string, n: number) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % n; };

/** Skabelonspørgsmål med flere formuleringer (bruges uden AI og mens AI-spørgsmålene hentes) */
export function templateQuestion(tp: PressTopic, seed = ''): string {
  const p = tp.params;
  const variant = tp.kind === 'result' ? `.${p.res}` : tp.kind === 'formerClub' ? `.${p.sacked}` : tp.kind === 'form' ? `.${p.streak}` : tp.kind === 'opponent' ? `.${p.fav}` : '';
  const base = `press.q.${tp.kind}${variant}`;
  const alts = [base, `${base}.2`, `${base}.3`].filter((k) => has(k));
  return t(alts.length ? alts[hashN(seed + tp.id, alts.length)] : base, p);
}

/** Opfundne journalister og medier (ingen rigtige personer eller redaktioner) */
const JOURNALISTS = { da: ['Mette Kjær, Boldposten', 'Jonas Bach, Sportsavisen Dag', 'Sofie Lund, Radio Bold', 'Kasper Holm, Kampbladet', 'Line Vestergaard, Fodbold Live'], en: ['Tom Hughes, The Touchline', 'Sarah Cole, Matchday Radio', 'Danny Price, The Terrace', 'Rachel Ford, Pitchside TV', 'Mark Ellis, The Football Post'] };

type Line = { who: 'q'; journalist: string; text: string } | { who: 'a'; text: string } | { who: 'r'; text: string; effects: string[] };

function effClass(e: string) {
  if (e === 'oppMotivated' || e === 'playerRisk' || e === 'promise') return 'warn';
  return /Up/.test(e) ? 'good' : /Down/.test(e) ? 'bad' : '';
}

export function PressScreen() {
  const g = useGame()!;
  const { back } = useNav();
  const pc = g.press;
  const ai = useAiAvailable();
  const key = pc ? `press:${pc.fixture}:${pc.phase}` : '';
  const [aiQ, setAiQ] = useState<Record<string, string>>(() => { try { const v = JSON.parse(aiText(key) ?? '{}'); return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'string' ? x : (x as { text: string }).text])); } catch { return {}; } });
  // kø af spørgsmål (opfølgninger indsættes undervejs), svar og samtalen
  const [queue, setQueue] = useState<PressTopic[]>(() => pc?.topics.slice() ?? []);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<{ topic: string; tone: string; kind: string; text?: string; q: string }[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [typing, setTyping] = useState(false);
  const [done, setDone] = useState<{ headline: string; body: string; effects: string[] } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const journalists = JOURNALISTS[g.lang === 'da' ? 'da' : 'en'];
  const questionText = (tp: PressTopic) => aiQ[tp.id] ?? templateQuestion(tp, `${pc?.fixture}`);
  const journalistFor = (i: number, tp: PressTopic, prev: Line[]) => {
    // opfølgninger stilles af samme journalist
    if (tp.kind.startsWith('follow')) { const q = prev.filter((l) => l.who === 'q').pop() as { journalist: string } | undefined; if (q) return q.journalist; }
    return journalists[((pc?.fixture ?? 0) + i) % journalists.length];
  };

  // AI formulerer hovedspørgsmålene, hvis den er tilgængelig
  useEffect(() => {
    if (!pc || !ai || Object.keys(aiQ).length) return;
    setQLoading(true);
    const me = g.clubs[g.userClub];
    const comp = g.comps[me?.league ?? ''];
    const pos = comp ? leagueRows(comp).findIndex((r) => r.club === g.userClub) + 1 : 0;
    aiCall<{ questions: { id: string; text: string }[] }>('press', {
      manager: g.manager.name, club: me?.name, league: comp?.name, position: pos || undefined, opponent: g.clubs[pc.opp]?.name,
      phase: pc.phase === 'pre' ? 'før kampen' : 'efter kampen',
      topics: pc.topics.map((tp) => ({ id: tp.id, kind: tp.kind, facts: tp.params, example: templateQuestion(tp) })),
    }).then((r) => {
      setQLoading(false);
      if (!r?.questions?.length) return;
      const map = Object.fromEntries(r.questions.filter((q) => pc.topics.some((tp) => tp.id === q.id)).map((q) => [q.id, q.text]));
      setAiQ(map);
      setAiText(key, JSON.stringify(map));
    });
  }, [ai, key]); // eslint-disable-line react-hooks/exhaustive-deps

  // første spørgsmål stilles, når skærmen åbnes – og opdateres, hvis AI-formuleringen kommer bagefter
  useEffect(() => {
    if (pc && queue.length && !lines.length) setLines([{ who: 'q', journalist: journalistFor(0, queue[0], []), text: questionText(queue[0]) }]);
  }, [pc?.fixture]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const first = queue[0];
    if (first && aiQ[first.id] && lines.length === 1 && lines[0].who === 'q') setLines([{ ...lines[0], text: aiQ[first.id] }]);
  }, [aiQ]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [lines.length, typing]);

  if (!pc && !done) return <div><Head title={t('press.title')} /><div className="empty">{t('press.none')}</div></div>;

  const current = queue[step];
  const media = Math.round(g.manager.media ?? 50);

  const sayText = (kind: string, id: string) => t(`press.a.${kind}.${id}`);
  const answer = (id: string, text?: string) => {
    if (!pc || !current || typing) return;
    const conf = pc as PressConf;
    const tone = toneOf(current.kind, id);
    const effects = effectsOf(current, id, conf.phase);
    const reaction = t(`press.react.${tone}.${1 + hashN(`${conf.fixture}${current.id}${tone}`, 3)}`);
    setAnswers([...answers, { topic: current.id, tone: id, kind: current.kind, text, q: questionText(current) }]);
    const follow = followUpFor(conf, current, id);
    const nextQueue = follow ? [...queue.slice(0, step + 1), follow, ...queue.slice(step + 1)] : queue;
    setQueue(nextQueue);
    const afterAnswer: Line[] = [...lines, { who: 'a', text: text ?? sayText(current.kind, id) }];
    setLines(afterAnswer);
    setDraft('');
    setTyping(true);
    // lokalet reagerer – og næste spørgsmål stilles lidt efter
    setTimeout(() => {
      const withReaction: Line[] = [...afterAnswer, { who: 'r', text: reaction, effects }];
      setLines(withReaction);
      const next = nextQueue[step + 1];
      setTimeout(() => {
        if (next) setLines([...withReaction, { who: 'q', journalist: journalistFor(step + 1, next, withReaction), text: questionText(next) }]);
        setStep(step + 1);
        setTyping(false);
      }, next ? 700 : 0);
    }, 450);
  };

  const freeAnswer = async () => {
    const text = draft.trim().slice(0, 400);
    if (!text || !current) return;
    setBusy('free');
    const allowed = tonesFor(current.kind);
    const r = await aiCall<{ tone: string }>('pressAnswer', { question: questionText(current), answer: text, allowed, meaning: Object.fromEntries(allowed.map((x) => [x, sayText(current.kind, x)])) });
    setBusy(null);
    answer(allowed.includes(r?.tone ?? '') ? r!.tone : allowed.find((x) => toneOf(current.kind, x) === 'calm') ?? allowed[0], text);
  };

  const finish = async (assistant?: boolean) => {
    if (!pc) return;
    setBusy('finish');
    const list = assistant ? pc.topics.map((tp) => ({ topic: tp.id, tone: 'deflect' })) : answers.map(({ topic, tone }) => ({ topic, tone }));
    let report: { headline: string; body: string } | null = null;
    // AI-referatet må højst holde spilleren hen i et par sekunder; kommer det senere, skiftes overskriften ud bagefter
    let late: Promise<{ headline: string; body: string } | null> | null = null;
    if (!assistant) {
      late = aiCall<{ headline: string; body: string }>('pressReport', {
        manager: g.manager.name, club: g.clubs[g.userClub]?.name, opponent: g.clubs[pc.opp]?.name, phase: pc.phase,
        qa: answers.map((a) => ({ question: a.q, answer: a.text ?? sayText(a.kind, a.tone), tone: toneOf(a.kind as PressTopic['kind'], a.tone) })),
      }, 12_000);
      report = await Promise.race([late, new Promise<null>((res) => setTimeout(() => res(null), 2500))]);
      if (report) late = null;
    }
    // uden AI: overskrift ud fra det mest markante svar
    if (!report && !assistant && answers.length) {
      const tones = answers.map((a) => toneOf(a.kind as PressTopic['kind'], a.tone));
      const pick = (['promise', 'fiery', 'pressurePlayer', 'deflect', 'confident', 'backPlayer', 'calm', 'backtrack'] as Tone[]).find((x) => tones.includes(x))!;
      const k = pick === 'deflect' && tones.filter((x) => x === 'deflect').length * 2 < tones.length ? 'calm' : pick;
      report = { headline: t(`press.head.${k}.${1 + hashN(`${pc.fixture}${k}`, 2)}`, { manager: g.manager.name, opp: g.clubs[pc.opp]?.name ?? '', club: g.clubs[g.userClub]?.short ?? '' }), body: '' };
    }
    const effects = assistant ? ['fansDown', 'mediaDown'] : [...new Set(answers.flatMap((a) => { const tp = queue.find((x) => x.id === a.topic); return tp ? effectsOf(tp, a.tone, pc.phase) : []; }))];
    act({ t: 'press', answers: list, headline: report?.headline, body: report?.body });
    setBusy(null);
    setDone({ ...(report ?? { headline: t(assistant ? 'press.sentAssistant' : 'press.reportPlain', { opp: g.clubs[pc.opp]?.name ?? '' }), body: '' }), effects });
    late?.then((r) => { if (r?.headline) setDone((d) => (d ? { ...d, headline: r.headline, body: r.body ?? '' } : d)); });
  };

  if (done) {
    return (
      <div>
        <Head title={t('press.title')} />
        <Panel title={t('press.headlines')}>
          <h3 style={{ marginTop: 0 }}>{done.headline}</h3>
          {done.body && <p style={{ lineHeight: 1.55 }}>{done.body}</p>}
          {done.effects.length > 0 && (
            <div className="press-effects" style={{ margin: '10px 0 14px', justifyContent: 'flex-start' }}>
              <span className="muted">{t('press.summary')}</span>
              {done.effects.map((e) => <span key={e} className={`tag ${effClass(e)}`}>{t(`press.eff.${e}`)}</span>)}
            </div>
          )}
          <div className="kv" style={{ marginBottom: 12 }}><span>{t('press.media')}</span><span><Bar value={Math.round(g.manager.media ?? 50)} /> {Math.round(g.manager.media ?? 50)}</span></div>
          <button className="primary" onClick={back}>{t('common.back')}</button>
        </Panel>
      </div>
    );
  }

  const conf = pc!;
  const finished = !current;
  return (
    <div>
      <Head title={t(conf.phase === 'pre' ? 'press.titlePre' : 'press.titlePost', { opp: g.clubs[conf.opp]?.name ?? '' })} />
      <div className="row" style={{ marginBottom: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="muted">{t('press.intro')}<Info topic="press" /></span>
        <span className="row" title={t('press.mediaHint')}>{t('press.media')} <Bar value={media} /> {media}</span>
      </div>
      <Panel className="press-room">
        <div className="press-feed">
          {qLoading && <AiSpinner text={t('ai.pressTyping')} />}
          {lines.map((l, i) => l.who === 'q' ? (
            <div key={i} className="press-q"><span className="press-who">🎤 {l.journalist}</span><p>“{l.text}”</p></div>
          ) : l.who === 'a' ? (
            <div key={i} className="press-a"><span className="press-who">{g.manager.name}</span><p>{l.text}</p></div>
          ) : (
            <div key={i} className="press-r">
              <span>{l.text}</span>
              {l.effects.length > 0 && <span className="press-effects">{l.effects.map((e) => <span key={e} className={`tag ${effClass(e)}`}>{t(`press.eff.${e}`)}</span>)}</span>}
            </div>
          ))}
          {typing && <div className="press-typing"><i /><i /><i /></div>}
          <div ref={endRef} />
        </div>
        {!finished && !typing && current && (
          <div className="press-answer">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {tonesFor(current.kind).map((id) => (
                <button key={id} className="press-opt" title={t(`press.tone.${toneOf(current.kind, id)}.hint`)} onClick={() => answer(id)}>
                  <span>“{sayText(current.kind, id)}”</span>
                  <span className="press-opt-fx">{effectsOf(current, id, (pc as PressConf).phase).map((e) => <span key={e} className={`tag ${effClass(e)}`}>{t(`press.eff.${e}`)}</span>)}</span>
                </button>
              ))}
            </div>
            {ai && (
              <div className="row" style={{ marginTop: 8 }}>
                <input style={{ flex: 1 }} maxLength={400} placeholder={t('press.freePlaceholder')} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') freeAnswer(); }} />
                <button disabled={busy === 'free' || !draft.trim()} onClick={freeAnswer}>{busy === 'free' ? <AiSpinner /> : t('press.answer')}</button>
              </div>
            )}
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('press.progress', { n: step + 1, total: queue.length })}</div>
          </div>
        )}
      </Panel>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        {!answers.length && <button onClick={() => finish(true)} disabled={!!busy}>{t('press.sendAssistant')}</button>}
        {finished && !typing && <button className="primary" disabled={!!busy} onClick={() => finish()}>{busy === 'finish' ? <AiSpinner text={t('press.writing')} /> : t('press.finish')}</button>}
      </div>
    </div>
  );
}
