import { Check, Pencil, Trash2 } from 'lucide-react';

const colors = ['violet', 'blue', 'orange', 'rose', 'teal', 'yellow'];
export function initials(name) { return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
export function playerColor(player) { return colors[[...player.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length]; }
export function PlayerAvatar({ player, small = false }) {
  return <span className={`avatar avatar-${playerColor(player)} ${small ? 'avatar-small' : ''}`} aria-hidden="true">{initials(player.name)}</span>;
}

export default function PlayerCard({ player, selected, onToggle, editMode, onEdit, onDelete }) {
  const content = <><PlayerAvatar player={player} /><span className="player-info"><span className="player-name">{player.name}</span><span className="player-subtitle">Skill rating <strong>{player.skill}</strong><span className="skill-track"><span style={{ width: `${player.skill}%` }} /></span></span></span></>;
  if (editMode) return <div className="player-card roster-card">{content}<div className="player-actions"><button className="icon-button" aria-label={`Edit ${player.name}`} onClick={() => onEdit(player)}><Pencil size={15} /></button><button className="icon-button danger-hover" aria-label={`Delete ${player.name}`} onClick={() => onDelete(player)}><Trash2 size={15} /></button></div></div>;
  return <button type="button" className={`player-card ${selected ? 'selected' : ''}`} aria-pressed={selected} aria-label={`${player.name}, skill ${player.skill}`} onClick={() => onToggle(player.id)}>{content}<span className="selection-check" aria-hidden="true">{selected && <Check size={13} strokeWidth={3} />}</span></button>;
}
