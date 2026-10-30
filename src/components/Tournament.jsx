import { useState } from 'react';
import { ArrowRight, CalendarDays, Check, Copy, Eye, Link, Medal, Plus, Trash2, Trophy, Users } from 'lucide-react';
import { getStandings, getTournamentStatus, formatTournament } from '../lib/tournament.js';
import Dialog from './Dialog.jsx';
import FixtureRow from './FixtureRow.jsx';
import TopScorers from './TopScorers.jsx';
import ViewerLinkDialog from './ViewerLinkDialog.jsx';

export default function Tournament({ store, onCreate, onToast, onMatchday, readOnly = false, sharedMode = false, onViewerLink }) {
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [shareText, setShareText] = useState('');
  const [copying, setCopying] = useState(false);
  const [showViewerLink, setShowViewerLink] = useState(false);
  const [viewerLinks, setViewerLinks] = useState({});
  const tournament = store.activeTournament;
  const standings = tournament ? getStandings(tournament) : [];
  const status = tournament ? getTournamentStatus(tournament) : null;
  const rounds = tournament ? [...new Set(tournament.fixtures.map((fixture) => fixture.round))] : [];
  const leaders = standings.filter((row) => row.rank === 1);
  async function share() {
    const text = formatTournament(tournament);
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error();
      await navigator.clipboard.writeText(text);
      onToast?.('Schedule and standings copied. Ready for the group chat.');
    } catch { setShareText(text); }
    finally { setCopying(false); }
  }
  async function removeTournament() {
    if (deleteBusy || readOnly) return;
    setDeleteBusy(true);
    try {
      const result = await store.remove(tournament.id);
      if (result) onToast?.(result);
      else { setDeleting(false); onToast?.('Tournament removed.'); }
    } catch (cause) { onToast?.(cause.message || 'This tournament could not be removed.'); }
    finally { setDeleteBusy(false); }
  }
  const copyButton = <button className="button button-secondary" disabled={copying} onClick={share}><Copy size={15} />{copying ? 'Copying…' : 'Copy schedule & table'}</button>;

  return <section className={`tournament-page ${readOnly ? 'tournament-readonly' : ''}`}>
    <div className="roster-hero tournament-hero"><div><div className="eyebrow"><span />ONE CUP. EVERY MOMENT.</div><h1>Every match.<br /><span>Every point.</span></h1><p>{readOnly ? 'Follow the fixtures, results, and Golden Boot race.' : 'Your schedule, results, and race to the top. All in one place.'}</p></div>{!readOnly && <button className="button button-primary" onClick={onCreate}><Plus size={17} />New tournament</button>}</div>
    {store.storageError && <p className="storage-warning" role="alert">{store.storageError}</p>}
    {!tournament ? <div className="tournament-empty"><span className="empty-trophy"><Trophy size={44} strokeWidth={1.3} /></span><h2>{readOnly ? 'Tournament unavailable' : <>A little competition.<br />A lot to play for.</>}</h2><p>{readOnly ? 'This tournament could not be loaded. Check the link with the organiser.' : <>Bring 2–6 teams. We’ll build the fixture list.<br />You enter the scores; we’ll keep the table.</>}</p>{!readOnly && <><button className="button button-primary" onClick={onCreate}>Create your first tournament<ArrowRight size={17} /></button><button className="text-button" onClick={onMatchday}>Or balance your teams first<ArrowRight size={14} /></button><div className="tournament-empty-features"><span><CalendarDays size={16} />Full match schedule</span><span><Medal size={16} />Live standings</span><span><Check size={16} />Saved on your device</span></div></>}</div> : <>
      {readOnly ? <div className="tournament-viewer-actions"><span><Eye size={16} />View only · Managed by the organiser</span>{copyButton}</div> : <div className="tournament-selector"><label><span className="field-label">YOUR TOURNAMENTS</span><select className="text-input" aria-label="Saved tournament" value={store.activeId} onChange={async (event) => { try { const result = await store.select(event.target.value); if (result) onToast?.(result); } catch (cause) { onToast?.(cause.message || 'This tournament could not be selected.'); } }}>{store.tournaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{copyButton}{sharedMode && onViewerLink && <button className="button button-secondary" onClick={() => setShowViewerLink(true)}><Link size={15} />Share viewer link</button>}<button className="icon-button danger-hover" aria-label="Delete tournament" onClick={() => setDeleting(true)}><Trash2 size={18} /></button></div>}
      <div className="tournament-overview"><div><span className="tournament-type">{tournament.settings.doubleRoundRobin ? 'HOME & AWAY' : 'ROUND ROBIN'} · {tournament.teams.length} TEAMS</span><h2>{tournament.name}</h2><p>{status.played} of {status.total} matches played <span>·</span> {status.complete ? 'Tournament complete' : `${status.total - status.played} to go`}</p></div><div className="tournament-progress"><span>{Math.round(status.played / status.total * 100)}<small>%</small></span><div><span style={{ width: `${status.played / status.total * 100}%` }} /></div></div></div>
      <div className={`tournament-leader ${status.complete ? 'champion-banner' : ''}`} role="status"><span className="leader-icon">{status.complete ? <Trophy size={26} /> : <Medal size={24} />}</span><div><span>{status.complete ? (status.winners.length > 1 ? 'JOINT WINNERS' : 'YOUR CHAMPIONS') : status.played ? (leaders.length > 1 ? 'LEVEL AT THE TOP' : 'CURRENT LEADERS') : 'ALL TO PLAY FOR'}</span><h3>{status.complete ? status.winners.map((team) => team.name).join(' & ') : status.played ? leaders.map((team) => team.name).join(' · ') : 'The first whistle is yours.'}</h3><p>{status.complete ? readOnly ? 'All results are in. Here are your tournament champions.' : 'All results are in. You can still correct a score below.' : '3 points for a win. 1 for a draw. Every game counts.'}</p></div></div>
      <section className="standings-section" aria-labelledby="standings-heading"><div className="section-heading"><div><h2 id="standings-heading">The league table<Medal size={17} /></h2><p>{readOnly ? 'The table follows the latest saved results.' : 'Updates automatically as you save results.'}</p></div><span className="live-table"><span className="status-dot" />LIVE STANDINGS</span></div><div className="standings-scroll" role="region" aria-label="Standings table, scroll horizontally on small screens" tabIndex={0}><table className="standings-table"><caption className="sr-only">{tournament.name} standings</caption><thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col" title="Played">P</th><th scope="col" title="Won">W</th><th scope="col" title="Drawn">D</th><th scope="col" title="Lost">L</th><th scope="col" title="Goals for">GF</th><th scope="col" title="Goals against">GA</th><th scope="col" title="Goal difference">GD</th><th scope="col">Pts</th></tr></thead><tbody>{standings.map((row) => <tr key={row.teamId} className={row.rank === 1 && status.played ? 'table-leader' : ''}><td>{row.rank}</td><th scope="row"><span className={`table-team-dot team-dot-${tournament.teams.findIndex((team) => team.id === row.teamId)}`} />{row.name}</th><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td><td className="table-points">{row.points}</td></tr>)}</tbody></table></div><p className="standings-rule">Ranked by points, goal difference, then goals scored. Teams still level share a position—and the title if tied at the end.</p></section>
      <TopScorers tournament={tournament} complete={status.complete} />
      <section className="schedule-section" aria-labelledby="schedule-heading"><div className="section-heading"><div><h2 id="schedule-heading">The fixture list<CalendarDays size={17} /></h2><p>{readOnly ? 'Fixtures, final scores, and scorers from the organiser.' : 'Save final scores, add goalscorers, or tap a kickoff time to change it.'}</p></div><span className="count-badge">{status.total} matches</span></div><div className="rounds-grid">{rounds.map((round) => {
        const fixtures = tournament.fixtures.filter((fixture) => fixture.round === round);
        const resting = tournament.teams.filter((team) => !fixtures.some((fixture) => fixture.homeId === team.id || fixture.awayId === team.id));
        return <section className="round-card" key={`${tournament.id}-${round}`} aria-label={`Round ${round}`}><div className="round-heading"><h3><span>{String(round).padStart(2, '0')}</span>Round {round}</h3><span>{fixtures.filter((fixture) => fixture.homeScore !== null && fixture.awayScore !== null).length}/{fixtures.length} played</span></div>{fixtures.map((fixture) => <FixtureRow key={fixture.id} fixture={fixture} teams={tournament.teams} tournament={tournament} readOnly={readOnly} onScore={readOnly ? undefined : (id, home, away) => store.updateScore(tournament.id, id, home, away)} onKickoff={readOnly ? undefined : (id, time) => store.updateKickoff(tournament.id, id, time)} onScorers={readOnly ? undefined : (id, entries) => store.updateScorers(tournament.id, id, entries)} onToast={onToast} />)}{resting.length > 0 && <p className="bye-note"><Users size={12} />Resting this round: {resting.map((team) => team.name).join(', ')}</p>}</section>;
      })}</div></section>
      <details className="tournament-squads"><summary><Users size={16} />Tournament squads<span>Fixed when the tournament was created</span></summary><div className="tournament-squad-grid">{tournament.teams.map((team) => <div key={team.id}><h3>{team.name}</h3><p>{team.players?.length ? team.players.map((player) => player.name).join(' · ') : 'Custom team · no player roster attached'}</p></div>)}</div></details>
      {deleting && !readOnly && <Dialog title="Delete this tournament?" onClose={() => { if (!deleteBusy) setDeleting(false); }}><p className="dialog-description"><strong>{tournament.name}</strong>, its schedule, and all its scores will be permanently removed. Your player roster is kept.</p><div className="dialog-actions"><button className="button button-secondary" onClick={() => setDeleting(false)} disabled={deleteBusy}>Keep tournament</button><button className="button button-danger" onClick={removeTournament} disabled={deleteBusy}>{deleteBusy ? 'Deleting…' : 'Delete tournament'}</button></div></Dialog>}
      {showViewerLink && !readOnly && sharedMode && <ViewerLinkDialog tournament={tournament} existingPath={viewerLinks[tournament.id]} onCreate={onViewerLink} onCreated={(path) => setViewerLinks((previous) => ({ ...previous, [tournament.id]: path }))} onClose={() => setShowViewerLink(false)} onToast={onToast} />}
      {shareText && <Dialog title="Share the tournament" onClose={() => setShareText('')}><p className="dialog-description">Select and copy the schedule and table below, then paste it into your group chat.</p><textarea className="share-text" aria-label="Tournament schedule and standings to copy" value={shareText} readOnly onFocus={(event) => event.target.select()} autoFocus /><div className="dialog-actions"><button className="button button-primary" onClick={() => setShareText('')}>Done</button></div></Dialog>}
    </>}
  </section>;
}
