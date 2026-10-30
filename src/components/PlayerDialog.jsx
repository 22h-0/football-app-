import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import Dialog from './Dialog.jsx';

export default function PlayerDialog({ player, onSave, onClose }) {
  const [name, setName] = useState(player?.name ?? '');
  const [skill, setSkill] = useState(player?.skill ?? 50);
  const [error, setError] = useState('');
  function submit(event) {
    event.preventDefault();
    const result = onSave(name, Number(skill));
    if (result) setError(result); else onClose();
  }
  return <Dialog title={player ? 'Edit player' : 'Add to the squad'} onClose={onClose}>
    <p className="dialog-description">A name and a rating. That’s all it takes.</p>
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="player-name">Player name</label>
      <input id="player-name" className="text-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Morgan" maxLength={40} required autoFocus autoComplete="off" />
      <div className="rating-label"><label className="field-label" htmlFor="player-skill">Skill rating</label><output htmlFor="player-skill">{skill}<span> / 100</span></output></div>
      <input id="player-skill" className="skill-slider" type="range" min="1" max="100" step="1" value={skill} onChange={(e) => setSkill(Number(e.target.value))} style={{ '--range-progress': `${(skill - 1) / 99 * 100}%` }} />
      <div className="rating-scale"><span>Just getting started</span><span>Game changer</span></div>
      <p className="form-hint">Rate everyone on the same scale for the fairest teams. You can adjust this anytime.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{player ? 'Save changes' : 'Add player'}<ArrowRight size={17} /></button></div>
    </form>
  </Dialog>;
}
