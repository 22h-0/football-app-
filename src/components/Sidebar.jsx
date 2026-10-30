import { ArrowUpRight, Check, CircleHelp, Users, Zap, LayoutGrid, Trophy } from 'lucide-react';

export default function Sidebar({ view, onNavigate, playerCount, onHelp, sharedMode = false }) {
  return (
    <aside className="sidebar">
      <a href="#matchday" className="brand" aria-label="Sideline home" onClick={(e) => { e.preventDefault(); onNavigate('match'); }}>
        <span className="brand-mark"><Zap size={23} fill="currentColor" strokeWidth={1.5} /></span>
        sideline<span className="brand-dot">.</span>
      </a>
      <div className="sidebar-caption">YOUR CLUBHOUSE</div>
      <nav aria-label="Main navigation" className="main-nav">
        <button className={`nav-item ${view === 'match' ? 'active' : ''}`} aria-current={view === 'match' ? 'page' : undefined} onClick={() => onNavigate('match')}>
          <LayoutGrid size={19} /><span>Matchday</span><span className="nav-active-dot" />
        </button>
        <button className={`nav-item ${view === 'roster' ? 'active' : ''}`} aria-current={view === 'roster' ? 'page' : undefined} onClick={() => onNavigate('roster')}>
          <Users size={19} /><span>Player roster</span><span className="nav-count">{playerCount}</span>
        </button>
        <button className={`nav-item ${view === 'tournament' ? 'active' : ''}`} aria-current={view === 'tournament' ? 'page' : undefined} onClick={() => onNavigate('tournament')}>
          <Trophy size={19} /><span>Tournaments</span><span className="nav-active-dot" />
        </button>
      </nav>
      <div className="sidebar-bottom">
        <div className="clubhouse-note"><span className="mini-ball">✦</span><h3>Good teams.<br />Great games.</h3><p>A little balance makes<br />all the difference.</p><span className="note-line" /></div>
        <button className="help-button" onClick={onHelp}><CircleHelp size={17} />How it works<ArrowUpRight size={15} /></button>
        <div className="device-status"><span><Check size={11} /></span>{sharedMode ? 'Creator accounts · Shared scores' : 'Local storage · No account'}</div>
      </div>
    </aside>
  );
}
