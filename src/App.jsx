import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CircleHelp, LockKeyhole, ShieldCheck, Users, Zap } from 'lucide-react';
import Sidebar from './components/Sidebar.jsx';
import PlayerList from './components/PlayerList.jsx';
import PlayerDialog from './components/PlayerDialog.jsx';
import Dialog from './components/Dialog.jsx';
import MatchSetup, { PitchIllustration, Steps } from './components/MatchSetup.jsx';
import TeamGenerator from './components/TeamGenerator.jsx';
import Tournament from './components/Tournament.jsx';
import TournamentSetup from './components/TournamentSetup.jsx';
import AccountDialog from './components/AccountDialog.jsx';
import SharedTournamentPage from './components/SharedTournamentPage.jsx';
import { useRoster } from './hooks/useRoster.js';
import { useTournaments } from './hooks/useTournaments.js';
import { useCloudTournaments } from './hooks/useCloudTournaments.js';
import { balanceTeams } from './lib/balanceTeams.js';

export default function App() {
  const sharedPath = window.location.pathname.match(/^\/watch\/([^/]+)\/?$/);
  if (sharedPath) return <SharedTournamentPage token={sharedPath[1]} />;
  return <Clubhouse />;
}

function Clubhouse() {
  const roster = useRoster();
  const localTournaments = useTournaments();
  const sharedMode = import.meta.env.VITE_SHARED_MODE === 'true' && window.location.protocol !== 'file:';
  const cloud = useCloudTournaments(sharedMode);
  const tournaments = sharedMode ? cloud : localTournaments;
  const [view, setView] = useState('match');
  const [teamCount, setTeamCount] = useState(2);
  const [teams, setTeams] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState('');
  const [generationError, setGenerationError] = useState('');
  const toastTimer = useRef(null);
  const selectedPlayers = roster.players.filter((player) => roster.selectedIds.includes(player.id));

  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function notify(message) { clearTimeout(toastTimer.current); setToast(message); toastTimer.current = setTimeout(() => setToast(''), 4000); }
  function navigate(next) { setView(next); setGenerationError(''); }
  function generate() {
    try {
      setTeams(balanceTeams(selectedPlayers, teamCount, Math.floor(Math.random() * 0x100000000)));
      setGenerationError('');
      window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    } catch (error) { setGenerationError(error.message || 'We couldn’t generate your teams. Please check your lineup.'); }
  }
  function savePlayer(name, skill) {
    const result = dialog.player ? roster.updatePlayer(dialog.player.id, name, skill) : roster.addPlayer(name, skill);
    if (!result) { setTeams(null); notify(dialog.player ? 'Player updated. Nice one.' : 'A new player joins the squad.'); }
    return result;
  }
  function removePlayer() {
    const result = roster.deletePlayer(dialog.player.id);
    if (result) { notify(result); return; }
    setTeams(null); setDialog(null); notify('Player removed from your roster.');
  }
  function openTournamentSetup() { setView('tournament'); setDialog({ type: sharedMode && !cloud.user ? 'auth' : 'tournament', next: 'create', teams }); }
  const listProps = { players: roster.players, selectedIds: roster.selectedIds, onToggle: roster.togglePlayer, onSelectAll: roster.selectAll, onClear: roster.clearSelection, onAdd: () => setDialog({ type: 'player' }), onEdit: (player) => setDialog({ type: 'player', player }), onDelete: (player) => setDialog({ type: 'delete', player }), onRoster: () => navigate('roster') };

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Sidebar view={view} onNavigate={navigate} playerCount={roster.players.length} sharedMode={sharedMode} onHelp={() => setDialog({ type: 'help' })} />
    <div className="main-shell ml-0 min-[701px]:ml-[170px] min-[961px]:ml-[190px] min-[1151px]:ml-[220px]">
      <header className="topbar"><div className="breadcrumb"><span>Clubhouse</span><span>/</span><strong>{view === 'roster' ? 'Player roster' : view === 'tournament' ? 'Tournaments' : 'Matchday'}</strong></div><div className="topbar-right"><span className="privacy-label"><LockKeyhole size={13} />{sharedMode ? 'Creator access · Shared tournaments' : 'Your squad. Your device.'}</span><button className="icon-button" aria-label="How it works" onClick={() => setDialog({ type: 'help' })}><CircleHelp size={19} /></button></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {sharedMode && <section className="account-bar" aria-label="Shared tournament account"><div><LockKeyhole size={19} /><span><strong>{cloud.user ? `Signed in as ${cloud.user.username}` : 'Your tournament. Your results.'}</strong><small>{cloud.user ? 'Only your account can edit the tournaments you create.' : 'Sign in to create a shared tournament. Your group watches through a read-only link.'}</small></span></div><button className="button button-secondary" disabled={cloud.loading} onClick={async () => { if (cloud.user) { const result = await cloud.logout(); if (result) notify(result); } else setDialog({ type: 'auth' }); }}>{cloud.user ? 'Sign out' : 'Sign in / Create account'}</button></section>}
        {sharedMode && cloud.error && <p className="storage-warning" role="alert">{cloud.error}</p>}
        {roster.storageError && <div className="storage-warning" role="alert"><ShieldCheck size={18} /><span>{roster.storageError}</span></div>}
        {view === 'tournament' ? <Tournament store={tournaments} sharedMode={sharedMode} onViewerLink={cloud.createViewerLink} onCreate={openTournamentSetup} onToast={notify} onMatchday={() => { setTeams(null); navigate('match'); }} /> : view === 'match' && teams ? <><Steps generated /><TeamGenerator teams={teams} onBack={() => setTeams(null)} onRegenerate={generate} onToast={notify} onTournament={openTournamentSetup} /></> : view === 'match' ? <>
          <section className="hero"><div className="hero-copy"><div className="eyebrow"><span />BETTER TEAMS. BETTER GAMES.</div><h1>Less planning.<br /><span>More playing.</span></h1><p>Your squad, perfectly matched. Pick your players<br className="desktop-break" /> and we’ll take care of the teams.</p></div><PitchIllustration /></section>
          <Steps /><div className="match-layout grid grid-cols-1 min-[961px]:grid-cols-[minmax(0,1fr)_260px] min-[1151px]:grid-cols-[minmax(0,1fr)_292px] min-[1440px]:grid-cols-[minmax(0,1fr)_310px]"><PlayerList {...listProps} /><MatchSetup selectedPlayers={selectedPlayers} teamCount={teamCount} setTeamCount={setTeamCount} onGenerate={generate} /></div>
        </> : <><section className="roster-hero"><div><div className="eyebrow"><span />THE PEOPLE MAKE THE GAME</div><h1>Your squad.<br /><span>Always ready.</span></h1><p>Add your players once. Bring them back every matchday.</p></div><button className="button button-secondary" onClick={() => { setTeams(null); navigate('match'); }}>Set up a match<ArrowRight size={17} /></button></section><PlayerList {...listProps} rosterMode /><div className="roster-tip"><ShieldCheck size={20} /><p><strong>Good ratings make good games.</strong> Use a consistent 1–100 scale across your squad. Ratings and availability save automatically in this browser.</p></div></>}
        {generationError && <p role="alert" className="form-error">{generationError}</p>}
        <footer className="page-footer"><span>LESS ADMIN. MORE BEAUTIFUL GAME.</span><span>Made for your next kickoff <span className="footer-star">✦</span></span></footer>
      </main>
    </div>
    {dialog?.type === 'player' && <PlayerDialog key={dialog.player?.id ?? 'new'} player={dialog.player} onClose={() => setDialog(null)} onSave={savePlayer} />}
    {dialog?.type === 'tournament' && <TournamentSetup generatedTeams={dialog.teams} onClose={() => setDialog(null)} onCreate={async (options) => { const result = await tournaments.create(options); if (!result) notify('Tournament created. Let the games begin.'); return result; }} />}
    {dialog?.type === 'auth' && <AccountDialog cloud={cloud} onClose={() => setDialog(null)} onDone={() => { if (dialog.next === 'create') setDialog({ type: 'tournament', teams: dialog.teams }); else setDialog(null); }} />}
    {dialog?.type === 'delete' && <Dialog title="Remove player?" onClose={() => setDialog(null)}><p className="dialog-description"><strong>{dialog.player.name}</strong> will be removed from your saved roster and today’s lineup. This can’t be undone.</p><div className="dialog-actions"><button className="button button-secondary" onClick={() => setDialog(null)}>Keep player</button><button className="button button-danger" onClick={removePlayer}>Remove player</button></div></Dialog>}
    {dialog?.type === 'help' && <Dialog title="From squad to kickoff." onClose={() => setDialog(null)}><p className="dialog-description">{sharedMode ? 'Balance your teams, then sign in to run your shared tournament.' : 'Three simple steps. No account, no spreadsheets.'}</p><ol className="help-steps"><li><span><Users size={20} /></span><div><h3>Build your roster</h3><p>Add names and skill ratings from 1 to 100. The starter squad is here to let you try things out—edit or remove anyone.</p></div></li><li><span><Check size={20} /></span><div><h3>Pick today’s players</h3><p>Tap players who are available and choose between 2 and 6 teams.</p></div></li><li><span><Zap size={20} /></span><div><h3>Generate. Share. Play.</h3><p>We aim for equal total skill and team sizes that differ by at most one player. Copy the lineup straight into your group chat.</p></div></li></ol><div className="help-privacy"><LockKeyhole size={16} />{sharedMode ? 'Your roster stays on this device. Shared tournaments save on the server; only the creator account can change results. Your group can watch through its read-only link.' : 'Data stays in this browser. Clearing site data removes your roster; private browsing may not retain it.'}</div><button className="button button-primary help-done" onClick={() => setDialog(null)}>Let’s play<ArrowRight size={17} /></button></Dialog>}
    <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast && <><span><Check size={15} /></span>{toast}</>}</div>
  </div>;
}
