import { useState } from 'react';
import { ArrowRight, CalendarDays, ShieldCheck, Trophy, Users } from 'lucide-react';
import Dialog from './Dialog.jsx';

function today() { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }

export default function TournamentSetup({ generatedTeams, onCreate, onClose }) {
  const available = Array.isArray(generatedTeams) && generatedTeams.length >= 2;
  const [useBalanced, setUseBalanced] = useState(available);
  const [name, setName] = useState('Weekend Cup');
  const [count, setCount] = useState(4);
  const [names, setNames] = useState(Array.from({ length: 6 }, (_, i) => `Team ${String.fromCharCode(65 + i)}`));
  const [doubleRoundRobin, setDoubleRoundRobin] = useState(false);
  const [scheduled, setScheduled] = useState(true);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState('19:00');
  const [matchMinutes, setMatchMinutes] = useState(20);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const teamCount = useBalanced ? generatedTeams.length : count;
  const fixtures = teamCount * (teamCount - 1) / (doubleRoundRobin ? 1 : 2);
  async function submit(event) {
    event.preventDefault();
    const teams = Array.from({ length: teamCount }, (_, i) => ({ id: `team-${i + 1}`, name: names[i], players: useBalanced ? generatedTeams[i] : [] }));
    setPending(true);
    const result = await onCreate({ name, teams, doubleRoundRobin, startAt: scheduled ? `${date}T${time}` : null, matchMinutes: Number(matchMinutes), breakMinutes: Number(breakMinutes) });
    setPending(false);
    if (result) setError(result); else onClose();
  }
  return <Dialog title="A new cup. A new story." onClose={onClose} className="tournament-setup-dialog">
    <p className="dialog-description">A complete fixture list, live standings, and every score in one place.</p>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="tournament-name">Tournament name</label><input className="text-input" id="tournament-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
      {available && <fieldset className="tournament-source"><legend className="field-label">Build your lineup</legend><label className={useBalanced ? 'source-option chosen' : 'source-option'}><input type="radio" name="team-source" checked={useBalanced} onChange={() => setUseBalanced(true)} /><ShieldCheck size={17} /><span>Use balanced teams<small>{generatedTeams.length} teams from your match</small></span></label><label className={!useBalanced ? 'source-option chosen' : 'source-option'}><input type="radio" name="team-source" checked={!useBalanced} onChange={() => setUseBalanced(false)} /><Users size={17} /><span>Enter team names<small>Bring your own teams</small></span></label></fieldset>}
      {!useBalanced && <div className="tournament-field"><label className="field-label" htmlFor="tournament-team-count">Number of teams</label><select id="tournament-team-count" className="text-input" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} teams</option>)}</select></div>}
      <div className="tournament-team-inputs">{Array.from({ length: teamCount }, (_, i) => <label key={i}><span className="field-label">Team {String.fromCharCode(65 + i)} name</span><input className="text-input" aria-label={`Team ${String.fromCharCode(65 + i)} name`} value={names[i]} maxLength={30} required onChange={(e) => setNames((old) => old.map((value, index) => index === i ? e.target.value : value))} />{useBalanced && <small>{generatedTeams[i].length} players · {generatedTeams[i].map((p) => p.name).join(', ')}</small>}</label>)}</div>
      <div className="tournament-field"><label className="field-label" htmlFor="tournament-format">Format</label><select id="tournament-format" className="text-input" value={doubleRoundRobin ? 'double' : 'single'} onChange={(e) => setDoubleRoundRobin(e.target.value === 'double')}><option value="single">Round robin · play each team once</option><option value="double">Home & away · play each team twice</option></select></div>
      <label className="schedule-toggle"><input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} /><CalendarDays size={17} />Schedule kickoff times</label>
      {scheduled && <><div className="tournament-two-fields"><label><span className="field-label">First match date</span><input className="text-input" aria-label="First match date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label><label><span className="field-label">First kickoff</span><input className="text-input" aria-label="First kickoff" type="time" required value={time} onChange={(e) => setTime(e.target.value)} /></label></div><div className="tournament-two-fields"><label><span className="field-label">Match length (minutes)</span><input className="text-input" aria-label="Match length (minutes)" type="number" min="1" max="180" step="1" required value={matchMinutes} onChange={(e) => setMatchMinutes(e.target.value)} /></label><label><span className="field-label">Break (minutes)</span><input className="text-input" aria-label="Break (minutes)" type="number" min="0" max="120" step="1" required value={breakMinutes} onChange={(e) => setBreakMinutes(e.target.value)} /></label></div><p className="form-hint schedule-explanation">Times are scheduled back-to-back on one pitch in your local time. You can change each kickoff later.</p></>}
      <div className="tournament-create-summary"><Trophy size={18} /><span>{teamCount} teams · {fixtures} matches · 3 points for a win</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create tournament'}<ArrowRight size={17} /></button></div>
    </form>
  </Dialog>;
}
