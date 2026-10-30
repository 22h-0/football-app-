import { Search, Plus, Users, ArrowUpRight, X } from 'lucide-react';
import { useState } from 'react';
import PlayerCard from './PlayerCard.jsx';

export default function PlayerList({ players, selectedIds, rosterMode = false, onToggle, onSelectAll, onClear, onAdd, onEdit, onDelete, onRoster }) {
  const [search, setSearch] = useState('');
  const visible = players.filter((player) => player.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const selected = new Set(selectedIds);
  return <section className="squad-panel" aria-labelledby="squad-heading">
    <div className="section-heading"><div><h2 id="squad-heading">{rosterMode ? 'Player roster' : 'Who’s playing?'}<span className="count-badge">{players.length}</span></h2><p>{rosterMode ? 'Your regulars, your ringers, your next signing.' : 'Pick today’s lineup from your saved roster.'}</p></div>{rosterMode ? <button className="button button-primary button-small" onClick={onAdd}><Plus size={16} />Add player</button> : <button className="text-button manage-button" onClick={onRoster}>Manage roster<ArrowUpRight size={15} /></button>}</div>
    <div className="roster-toolbar"><label className="search-field"><Search size={17} /><input aria-label="Search players" placeholder="Find a player…" value={search} onChange={(e) => setSearch(e.target.value)} />{search && <button aria-label="Clear search" className="icon-button" onClick={() => setSearch('')}><X size={14} /></button>}</label>{!rosterMode && <button className="text-button selection-action" onClick={selectedIds.length === players.length && players.length > 0 ? onClear : onSelectAll} disabled={!players.length}>{selectedIds.length === players.length && players.length > 0 ? 'Clear selection' : 'Select all'}</button>}</div>
    {visible.length > 0 ? <div className={`player-grid grid ${rosterMode ? 'full-roster-grid grid-cols-1 min-[521px]:grid-cols-2 min-[1151px]:grid-cols-3' : 'grid-cols-1 min-[371px]:grid-cols-2 min-[1440px]:grid-cols-3'}`}>{visible.map((player) => <PlayerCard key={player.id} player={player} selected={selected.has(player.id)} onToggle={onToggle} editMode={rosterMode} onEdit={onEdit} onDelete={onDelete} />)}</div> : <div className="empty-state"><span className="empty-icon"><Users size={28} /></span><h3>{players.length ? 'No players found' : 'Every great game starts with a squad.'}</h3><p>{players.length ? 'Try a different name.' : 'Add your first player and give them a skill rating.'}</p>{!players.length && <button className="button button-primary" onClick={onAdd}><Plus size={17} />Add your first player</button>}</div>}
    <div className="roster-footer"><span><span className="status-dot" />{rosterMode ? 'Roster saved automatically on this device' : `${selectedIds.length} player${selectedIds.length === 1 ? '' : 's'} selected for today`}</span>{!rosterMode && <button className="text-button" onClick={onAdd}><Plus size={14} />Add player</button>}</div>
  </section>;
}
