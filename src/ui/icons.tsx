// Små linjeikoner til menuen (24×24, stroke = currentColor)
const P: Record<string, string> = {
  managers: 'M4 5h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM19 9h1a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1v3l-4-3h-3',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z',
  squad: 'M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1a3 3 0 0 0-2-2.8M17 5.2a3 3 0 0 1 0 5.6M4 19v-1a3 3 0 0 1 2-2.8M7 5.2a3 3 0 0 0 0 5.6',
  tactics: 'M4 4h16v16H4zM4 12h16M12 4v16M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6',
  training: 'M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12',
  fixtures: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4M8 14h2M14 14h2M8 17h2',
  competitions: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4',
  transfers: 'M4 8h13l-3-3M20 16H7l3 3',
  scouting: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14M20 20l-4-4',
  assistant: 'M12 3l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z',
  staff: 'M9 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M12 14v3',
  finance: 'M12 3v18M16 7h-5.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H7',
  club: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  draft: 'M4 5h16M4 12h16M4 19h10M18 16l3 3-3 3',
  support: 'M12 21s-7-4.4-9.3-9.1C1.1 8.6 3 5 6.4 5c2 0 3.3 1.1 4.1 2.3h3c.8-1.2 2.1-2.3 4.1-2.3 3.4 0 5.3 3.6 3.7 6.9C19 16.6 12 21 12 21z',
  community: 'M7 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20v-1a5 5 0 0 1 9-3M22 20v-1a5 5 0 0 0-9-3M8 20v-1a4 4 0 0 1 8 0v1',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  board: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M3 10h18',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01',
  ranking: 'M4 20v-7h5v7M9.5 20V6h5v14M15 20v-4h5v4M3 20h18',
  awards: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12M8.5 14l-1.5 7 5-3 5 3-1.5-7',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  jobs: 'M4 8h16v11H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
  options: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  quit: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10',
};

export function Icon({ name }: { name: string }) {
  const d = P[name];
  if (!d) return null;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ---------- ikoner til indbakken: én pr. slags nyhed, farvet efter kategori/udfald ----------

const N: Record<string, string> = {
  ball: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7.5l3.5 2.5-1.3 4h-4.4l-1.3-4zM12 3v4.5M15.5 10l4.8-1.6M14.2 14l3 4M9.8 14l-3 4M8.5 10l-4.8-1.6',
  injury: 'M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z',
  bid: P.transfers,
  done: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M8 12.5l2.8 2.8L16.5 9.5',
  rumour: 'M3 10.5v3a1 1 0 0 0 1 1h3l5 4v-13l-5 4H4a1 1 0 0 0-1 1M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11',
  digest: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  press: 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7',
  contract: 'M6 3h8.5L19 7.5V21H6zM14 3v5h5M9 13h6M9 17h4',
  chat: 'M4 5h16v11H10l-5 4v-4H4z',
  board: 'M4 21h16M6 21V9.5L12 5l6 4.5V21M10 21v-5h4v5M9.5 12h.01M14.5 12h.01',
  warning: 'M12 4l9 16H3zM12 10v4.5M12 17.5h.01',
  money: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M14.5 9h-3.2a1.8 1.8 0 0 0 0 3.5h1.4a1.8 1.8 0 0 1 0 3.5H9.5M12 7.5V9M12 16v1.5',
  trophy: P.competitions,
  medal: P.awards,
  youth: 'M12 21v-8.5M12 12.5c0-4.5 3-7.5 8-7.5 0 5-3 7.5-8 7.5M12 15c0-3.5-2.5-5.5-7-5.5 0 4 2.5 5.5 7 5.5',
  scout: P.scouting,
  job: P.jobs,
  fans: 'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 16h3',
  star: P.assistant,
};

type Tone = 'green' | 'red' | 'grey' | 'blue' | 'yellow' | 'purple' | 'teal' | 'orange' | 'pink' | 'lime';

/** Ikon og farve ud fra nyhedens nøgle (og kategori som reserve) */
export function newsVisual(key: string, cat: string): { icon: string; tone: Tone } {
  if (key === 'match.won') return { icon: 'ball', tone: 'green' };
  if (key === 'match.lost') return { icon: 'ball', tone: 'red' };
  if (key === 'match.drew') return { icon: 'ball', tone: 'grey' };
  if (key.startsWith('press.') || key.startsWith('pressConf')) return { icon: 'press', tone: 'grey' };
  if (key === 'jab.right') return { icon: 'press', tone: 'green' };
  if (key === 'jab.backfired') return { icon: 'press', tone: 'red' };
  if (key.startsWith('jab.')) return { icon: 'press', tone: 'pink' };
  if (key === 'bet.won') return { icon: 'money', tone: 'green' };
  if (key === 'bet.lost') return { icon: 'money', tone: 'red' };
  if (key.startsWith('fans.') || key.startsWith('trophy.fans')) return { icon: 'fans', tone: 'pink' };
  if (key === 'news.champions' || key === 'news.cupWin' || key === 'news.playoffWin' || key.startsWith('trophy.board') || key.startsWith('trophy.press')) return { icon: 'trophy', tone: 'orange' };
  if (key.startsWith('trophy.captain')) return { icon: 'chat', tone: 'orange' };
  if (key.startsWith('rumour.')) return { icon: 'rumour', tone: 'blue' };
  if (key.startsWith('transfer.digest')) return { icon: 'digest', tone: 'blue' };
  if (/^transfer\.(bidRejected|notForSale|talksCollapsed|refuse|lostBiddingWar|aiWithdrew|loanRejected|playerRefusedMove)/.test(key)) return { icon: 'bid', tone: 'red' };
  if (key === 'board.sacked' || key === 'board.sackedSeason' || key === 'board.warning' || key === 'news.applyRejected' || key === 'job.withdrawn') return { icon: 'warning', tone: 'red' };
  if (key.startsWith('will.') || key.startsWith('reject.r.') || key.startsWith('complaint')) return { icon: 'chat', tone: 'purple' };
  if (key.startsWith('enquiry.')) return { icon: 'chat', tone: 'blue' };
  if (key.startsWith('budget.') || key.startsWith('sponsor.') || key.startsWith('ffp')) return { icon: 'money', tone: 'yellow' };
  if (/^transfer\.(done|freeDone|loanDone|bosmanDone|bidAccepted|loanAccepted|releaseMet|optionExercised)/.test(key) || key === 'news.newJob' || key === 'job.invite') return { icon: 'done', tone: key.startsWith('transfer.') ? 'blue' : 'pink' };
  if (key.startsWith('award.month') || key.startsWith('award.player') || key.startsWith('award.top')) return { icon: 'medal', tone: 'orange' };
  switch (cat) {
    case 'match': return { icon: 'ball', tone: 'green' };
    case 'injury': return { icon: 'injury', tone: 'red' };
    case 'transfer': return { icon: 'bid', tone: 'blue' };
    case 'contract': return { icon: 'contract', tone: 'purple' };
    case 'board': return { icon: 'board', tone: 'yellow' };
    case 'finance': return { icon: 'money', tone: 'yellow' };
    case 'award': return { icon: 'trophy', tone: 'orange' };
    case 'youth': return { icon: 'youth', tone: 'lime' };
    case 'scout': return { icon: 'scout', tone: 'teal' };
    case 'job': return { icon: 'job', tone: 'pink' };
    default: return { icon: 'news', tone: 'grey' };
  }
}

export function NewsIcon({ newsKey, cat }: { newsKey: string; cat: string }) {
  const v = newsVisual(newsKey, cat);
  return (
    <span className={`news-icon tone-${v.tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d={N[v.icon]} /></svg>
    </span>
  );
}

/** Lille øje: andre klubber holder øje med spilleren */
export function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px' }}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6" />
    </svg>
  );
}
