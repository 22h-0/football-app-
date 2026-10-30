import { ArrowLeft, Check, Copy, RefreshCw, ShieldCheck, Trophy, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PlayerAvatar } from './PlayerCard.jsx';
import Dialog from './Dialog.jsx';

const teamNames = ['Blue', 'Coral', 'Violet', 'Amber', 'Teal', 'Pink'];
const teamClasses = ['blue', 'coral', 'violet', 'amber', 'teal', 'pink'];

export function formatTeams(teams) {
  return `⚽ SIDELINE · GAME ON\n\n${teams.map((team, i) => `${['🔵', '🔴', '🟣', '🟡', '🟢', '🌸'][i]} Team ${String.fromCharCode(65 + i)} · ${teamNames[i]}\n${team.map((player, j) => `${j + 1}. ${player.name} (${player.skill})`).join('\n')}\nTotal skill: ${team.reduce((sum, player) => sum + player.skill, 0)}`).join('\n\n')}\n\nBetter teams. Better games.`;
}

export default function TeamGenerator({ teams, onBack, onRegenerate, onToast, onTournament }) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const resultHeading = useRef(null);
  useEffect(() => { resultHeading.current?.focus({ preventScroll: true }); }, [teams]);
  const totals = teams.map((team) => team.reduce((sum, player) => sum + player.skill, 0));
  const spread = Math.max(...totals) - Math.min(...totals);
  const totalPlayers = teams.reduce((sum, team) => sum + team.length, 0);
  async function copy() {
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(formatTeams(teams));
      setCopied(true);
      onToast('Teams copied. Drop them in the group chat.');
    } catch { setManualCopy(true); }
    finally { setCopying(false); }
  }
  return <section className="results-section">
    <div className="results-toolbar"><button className="text-button" onClick={onBack}><ArrowLeft size={16} />Edit lineup</button><span className="results-ready"><span className="status-dot" />READY FOR KICKOFF</span></div>
    <div className="results-heading"><div><div className="eyebrow">LEAVE IT ALL ON THE PITCH</div><h1 ref={resultHeading} tabIndex={-1}>Your teams.<br /><span>Your game.</span></h1><p>The lineup is set. Now let the football do the talking.</p></div><span className="trophy-mark" aria-hidden="true"><Trophy size={54} strokeWidth={1.2} /></span></div>
    <div className="results-summary"><div><span className="summary-icon"><ShieldCheck size={21} /></span><div><strong>{spread === 0 ? 'Perfectly balanced' : `${spread} point${spread === 1 ? '' : 's'} between highest & lowest`}</strong><p>{spread === 0 ? 'Equal total skill. All to play for.' : 'Balanced by total skill with even team sizes.'}</p></div></div><span className="summary-player-count"><Users size={16} />{totalPlayers} players · {teams.length} teams</span></div>
    <div className="teams-grid">{teams.map((team, i) => <article className={`team-card team-${teamClasses[i]}`} key={i}><header className="team-heading"><span className="team-letter">{String.fromCharCode(65 + i)}</span><div><h2>Team {String.fromCharCode(65 + i)}</h2><p>{teamNames[i]} squad · {team.length} players</p></div><span className="team-skill"><strong>{totals[i]}</strong><span>TOTAL SKILL</span></span></header><ol className="team-player-list">{team.map((player, index) => <li key={player.id}><span className="team-player-number">{String(index + 1).padStart(2, '0')}</span><PlayerAvatar player={player} small /><span className="player-name">{player.name}</span><span className="team-player-skill">{player.skill}</span></li>)}</ol><footer className="team-footer"><span>Average skill</span><strong>{(totals[i] / team.length).toFixed(1)}<span> / 100</span></strong></footer></article>)}</div>
    <div className="result-actions"><button className="button button-secondary" onClick={() => { setCopied(false); onRegenerate(); }}><RefreshCw size={17} />Shuffle again</button><button className="button button-primary" onClick={copy} disabled={copying}>{copied ? <Check size={17} /> : <Copy size={17} />}{copying ? 'Copying…' : copied ? 'Copied to clipboard' : 'Copy teams for WhatsApp'}</button></div>
    <p className="result-footnote">Same squad, a fresh mix. Shuffling keeps team sizes and balance in mind.</p>
    <div className="create-cup-banner"><span><Trophy size={23} /></span><div><h3>Make a day of it.</h3><p>Turn these teams into a tournament. Fixtures, scores, and a winner.</p></div><button className="button button-secondary" onClick={onTournament}>Create tournament<ArrowLeft size={15} className="rotate-180" /></button></div>
    {manualCopy && <Dialog title="Share your teams" onClose={() => setManualCopy(false)}><p className="dialog-description">Your browser couldn’t access the clipboard. Select and copy the text below, then paste it into your group chat.</p><textarea className="share-text" readOnly value={formatTeams(teams)} aria-label="Team lists to copy" onFocus={(event) => event.target.select()} autoFocus /><div className="dialog-actions"><button className="button button-primary" onClick={() => setManualCopy(false)}>Done</button></div></Dialog>}
  </section>;
}
