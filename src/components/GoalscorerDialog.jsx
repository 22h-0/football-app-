import { useState } from 'react';
import { Check, Plus, Target, Trash2 } from 'lucide-react';
import Dialog from './Dialog.jsx';
import { normalizeScorers } from '../lib/goalscorers.js';

function rowKey() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

export default function GoalscorerDialog({ fixture, tournament, onSave, onClose, onToast }) {
  const [entries, setEntries] = useState(() => (fixture.scorers ?? []).map((entry) => ({ ...entry, rowId: rowKey() })));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const matchTeams = [fixture.homeId, fixture.awayId].map((id) => tournament.teams.find((team) => team.id === id));
  function update(rowId, patch) { setEntries((previous) => previous.map((entry) => entry.rowId === rowId ? { ...entry, ...patch } : entry)); setError(''); }
  function add(team) {
    const roster = team.players ?? [];
    const unused = roster.find((player) => !entries.some((entry) => entry.teamId === team.id && entry.playerId === player.id));
    setEntries((previous) => [...previous, { rowId: rowKey(), teamId: team.id, playerId: unused?.id ?? null, name: unused?.name ?? '', goals: 1 }]);
    setError('');
  }
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    setError('');
    let canonical;
    try { canonical = normalizeScorers(tournament, fixture, entries.map(({ rowId, ...entry }) => ({ ...entry, goals: Number(entry.goals) }))); }
    catch (cause) { setError(cause.message); return; }
    setSaving(true);
    try {
      const result = await onSave(canonical);
      if (result) setError(result);
      else { onToast?.('Goalscorers saved. Golden Boot updated.'); onClose(); }
    } catch (cause) { setError(cause.message || 'Goalscorers could not be saved. Please try again.'); }
    finally { setSaving(false); }
  }
  return <Dialog title="Who found the net?" onClose={() => { if (!saving) onClose(); }} className="goalscorer-dialog">
    <p className="dialog-description">Add the scorers for this result. Goals can stay unassigned until you know who scored them.</p>
    <form onSubmit={submit}>
      <div className="goalscorer-teams">{matchTeams.map((team) => {
        const teamEntries = entries.filter((entry) => entry.teamId === team.id);
        const total = team.id === fixture.homeId ? fixture.homeScore : fixture.awayScore;
        const assigned = teamEntries.reduce((sum, entry) => sum + (Number(entry.goals) || 0), 0);
        const roster = team.players ?? [];
        const suggestions = [...new Set(tournament.fixtures.flatMap((match) => match.scorers ?? []).filter((entry) => entry.teamId === team.id).map((entry) => entry.name))];
        return <section className="goalscorer-team" key={team.id} aria-label={`Goalscorers for ${team.name}`}>
          <header><h3><Target size={16} />{team.name}</h3><span className={assigned > total ? 'over-assigned' : ''}>{assigned} / {total} goals assigned</span></header>
          {teamEntries.length === 0 && <p className="scorer-team-empty">{total === 0 ? 'No goals to assign for this team.' : 'No scorers added yet.'}</p>}
          {teamEntries.map((entry, index) => <div className="goalscorer-entry" key={entry.rowId}>
            <label className="scorer-player-field"><span className="field-label">Player</span>{roster.length ? <select className="text-input" aria-label={`Goalscorer ${index + 1} for ${team.name}`} value={entry.playerId ?? ''} disabled={saving} onChange={(event) => { const player = roster.find((item) => item.id === event.target.value); update(entry.rowId, { playerId: player?.id ?? null, name: player?.name ?? '' }); }} required><option value="">Choose a player</option>{roster.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select> : <><input className="text-input" aria-label={`Goalscorer ${index + 1} for ${team.name}`} value={entry.name} placeholder="Player name" maxLength={40} disabled={saving} required list={`scorer-names-${team.id}-${entry.rowId}`} onChange={(event) => update(entry.rowId, { name: event.target.value, playerId: null })} /><datalist id={`scorer-names-${team.id}-${entry.rowId}`}>{suggestions.map((name) => <option key={name} value={name} />)}</datalist></>}</label>
            <label className="scorer-goals-field"><span className="field-label">Goals</span><input className="text-input" aria-label={`Goals by scorer ${index + 1} for ${team.name}`} inputMode="numeric" type="number" min="1" max="99" step="1" required value={entry.goals} disabled={saving} onChange={(event) => update(entry.rowId, { goals: event.target.value })} /></label>
            <button className="icon-button danger-hover remove-scorer" type="button" aria-label={`Remove scorer ${index + 1} for ${team.name}`} disabled={saving} onClick={() => { setEntries((previous) => previous.filter((item) => item.rowId !== entry.rowId)); setError(''); }}><Trash2 size={16} /></button>
          </div>)}
          <button type="button" className="text-button add-scorer" aria-label={`Add scorer for ${team.name}`} onClick={() => add(team)} disabled={saving || total === 0 || teamEntries.length >= total || (roster.length > 0 && teamEntries.length >= roster.length)}><Plus size={15} />Add scorer</button>
          {assigned < total && <p className="unassigned-note">{total - assigned} goal{total - assigned === 1 ? '' : 's'} still unassigned</p>}
        </section>;
      })}</div>
      <p className="form-hint">One entry per player per match. Use the goals count for a brace or hat-trick. Only players from a saved tournament squad can score for that team.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button button-primary" disabled={saving}><Check size={16} />{saving ? 'Saving…' : 'Save goalscorers'}</button></div>
    </form>
  </Dialog>;
}
