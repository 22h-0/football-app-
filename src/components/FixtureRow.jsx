import { useEffect, useState } from 'react';
import { CalendarClock, Check, RotateCcw, Target } from 'lucide-react';
import GoalscorerDialog from './GoalscorerDialog.jsx';

function displayKickoff(value, readOnly) {
  if (!value) return readOnly ? 'Kickoff to be confirmed' : 'Set kickoff time';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Kickoff to be confirmed';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export default function FixtureRow({ fixture, teams, tournament, onScore, onKickoff, onScorers, onToast, readOnly = false }) {
  const [home, setHome] = useState(fixture.homeScore ?? '');
  const [away, setAway] = useState(fixture.awayScore ?? '');
  const [kickoff, setKickoff] = useState(fixture.kickoff ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [showScorers, setShowScorers] = useState(false);
  useEffect(() => { setHome(fixture.homeScore ?? ''); setAway(fixture.awayScore ?? ''); }, [fixture.homeScore, fixture.awayScore]);
  useEffect(() => { setKickoff(fixture.kickoff ?? ''); }, [fixture.kickoff]);
  const homeTeam = teams.find((team) => team.id === fixture.homeId);
  const awayTeam = teams.find((team) => team.id === fixture.awayId);
  const label = `${homeTeam.name} vs ${awayTeam.name}`;
  const played = fixture.homeScore !== null && fixture.awayScore !== null;
  const scorers = fixture.scorers ?? [];
  const unassigned = played ? fixture.homeScore + fixture.awayScore - scorers.reduce((sum, scorer) => sum + scorer.goals, 0) : 0;
  const dirty = String(home) !== String(fixture.homeScore ?? '') || String(away) !== String(fixture.awayScore ?? '');
  const resultText = played ? fixture.homeScore === fixture.awayScore ? 'Draw · 1 point each' : `${fixture.homeScore > fixture.awayScore ? homeTeam.name : awayTeam.name} won` : readOnly ? 'Awaiting the final score.' : 'Enter the final score when the match ends.';
  async function saveScore(event) {
    event.preventDefault();
    if (saving || readOnly) return;
    if (home === '' || away === '') { setError('Enter a score for both teams. A 0–0 draw is valid.'); return; }
    setSaving('score');
    try { const result = await onScore(fixture.id, Number(home), Number(away)); if (result) setError(result); else { setError(''); onToast?.('Result saved. Standings updated.'); } }
    catch (cause) { setError(cause.message || 'The result could not be saved.'); }
    finally { setSaving(''); }
  }
  async function clear() {
    if (saving || readOnly) return;
    setSaving('clear');
    try { const result = await onScore(fixture.id, null, null); if (result) setError(result); else { setHome(''); setAway(''); setError(''); onToast?.('Result cleared. Match marked as upcoming.'); } }
    catch (cause) { setError(cause.message || 'The result could not be cleared.'); }
    finally { setSaving(''); }
  }
  async function saveTime(event) {
    event.preventDefault();
    if (saving || readOnly) return;
    setSaving('time');
    try { const result = await onKickoff(fixture.id, kickoff); if (result) setError(result); else { setError(''); onToast?.('Kickoff time saved.'); } }
    catch (cause) { setError(cause.message || 'The kickoff time could not be saved.'); }
    finally { setSaving(''); }
  }
  return <article className={`fixture-row ${played ? 'fixture-played' : ''}`} aria-label={label}>
    <div className="fixture-meta">{readOnly ? <span className="fixture-kickoff-static"><CalendarClock size={13} />{displayKickoff(fixture.kickoff, true)}</span> : <details className="fixture-kickoff"><summary><CalendarClock size={13} />{displayKickoff(fixture.kickoff, false)}</summary><form onSubmit={saveTime}><label className="field-label" htmlFor={`kickoff-${fixture.id}`}>Kickoff in your local time</label><div><input type="datetime-local" className="text-input" id={`kickoff-${fixture.id}`} aria-label={`Kickoff for ${label}`} value={kickoff} disabled={Boolean(saving)} onChange={(event) => setKickoff(event.target.value)} /><button type="submit" className="icon-button" disabled={Boolean(saving)} aria-label={`Save kickoff for ${label}`}><Check size={18} /></button></div><span>Leave blank to remove the time.</span></form></details>}<span className={`fixture-status ${played ? 'finished' : ''}`}>{played ? 'FULL TIME' : 'UPCOMING'}</span></div>
    {readOnly ? <><div className="fixture-teams"><span className="fixture-team-name">{homeTeam.name}</span><div className="score-inputs readonly-scores" aria-label={`Result: ${label}`}><strong>{fixture.homeScore ?? '–'}</strong><span>:</span><strong>{fixture.awayScore ?? '–'}</strong></div><span className="fixture-team-name fixture-away-name">{awayTeam.name}</span></div><p className="readonly-result-text">{resultText}</p></> : <form className="fixture-score-form" onSubmit={saveScore}>
      <div className="fixture-teams"><span className="fixture-team-name">{homeTeam.name}</span><div className="score-inputs"><input aria-label={`Home score: ${label}`} inputMode="numeric" type="number" min="0" max="99" step="1" placeholder="–" value={home} disabled={Boolean(saving)} onChange={(event) => setHome(event.target.value)} /><span>:</span><input aria-label={`Away score: ${label}`} inputMode="numeric" type="number" min="0" max="99" step="1" placeholder="–" value={away} disabled={Boolean(saving)} onChange={(event) => setAway(event.target.value)} /></div><span className="fixture-team-name fixture-away-name">{awayTeam.name}</span></div>
      <div className="fixture-result-actions"><span>{resultText}</span>{played && <button type="button" className="icon-button" aria-label={`Clear result for ${label}`} disabled={Boolean(saving)} onClick={clear}><RotateCcw size={13} /></button>}<button type="submit" className="button button-secondary save-score" disabled={Boolean(saving) || (played && !dirty)} aria-label={`Save result for ${label}`}><Check size={13} />{saving === 'score' ? 'Saving…' : played && !dirty ? 'Saved' : 'Save result'}</button></div>
    </form>}
    {played && <div className="fixture-scorers"><div className="fixture-scorers-heading"><span><Target size={12} />Goalscorers</span>{!readOnly && tournament && onScorers && <button className="text-button" aria-label={`Goalscorers for ${label}`} onClick={() => setShowScorers(true)}>{scorers.length ? 'Edit scorers' : 'Add scorers'}</button>}</div>{scorers.length > 0 && <div className="fixture-scorer-chips">{scorers.map((scorer) => <span className="fixture-scorer-chip" key={`${scorer.teamId}-${scorer.playerId ?? scorer.name}`} title={teams.find((team) => team.id === scorer.teamId)?.name}>{scorer.name}<strong>{scorer.goals}</strong></span>)}</div>}{unassigned > 0 && <p className="fixture-unassigned">{unassigned} goal{unassigned === 1 ? '' : 's'} not assigned to a scorer yet</p>}{!scorers.length && unassigned === 0 && <p className="fixture-unassigned">No goals scored in this match.</p>}</div>}
    {error && !readOnly && <p className="form-error" role="alert">{error}</p>}
    {showScorers && !readOnly && <GoalscorerDialog fixture={fixture} tournament={tournament} onSave={(entries) => onScorers(fixture.id, entries)} onClose={() => setShowScorers(false)} onToast={onToast} />}
  </article>;
}
