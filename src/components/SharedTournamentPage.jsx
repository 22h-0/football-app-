import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, Eye, RefreshCw, ShieldCheck, Trophy, WifiOff, Zap } from 'lucide-react';
import { useSharedTournament } from '../hooks/useCloudTournaments.js';
import Tournament from './Tournament.jsx';

function messageOf(error) {
  return typeof error === 'string' ? error : error?.message || 'Could not retrieve this tournament. Check your connection and try again.';
}

export default function SharedTournamentPage({ token }) {
  const { tournament, loading, error, lastUpdated, refresh } = useSharedTournament(token);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function notify(message) {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 4000);
  }
  const received = lastUpdated ? new Date(lastUpdated) : null;
  const receivedLabel = received && !Number.isNaN(received.getTime())
    ? received.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  const store = { tournaments: tournament ? [tournament] : [], activeId: tournament?.id || null, activeTournament: tournament, storageError: null };

  return <div className="shared-page">
    <a className="skip-link" href="#shared-main">Skip to tournament</a>
    <header className="shared-header"><a href="/" className="brand" aria-label="Sideline home"><span className="brand-mark"><Zap size={23} fill="currentColor" strokeWidth={1.5} /></span>sideline<span className="brand-dot">.</span></a><span className="spectator-badge"><Eye size={15} />Spectator view</span></header>
    <main id="shared-main" className="shared-main" tabIndex={-1}>
      <div className="spectator-notice"><ShieldCheck size={20} /><div><strong>You’re here for the game.</strong><p>Follow the fixtures, scores, table, and goalscorers. Only the tournament owner can make changes.</p></div></div>
      <div className="shared-update-bar"><span><Clock3 size={14} />{receivedLabel ? `Last received ${receivedLabel}` : 'Waiting for tournament data'}{tournament && !error && <small>Checks every 10 seconds</small>}</span><button type="button" className="button button-secondary button-small" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'refresh-spinning' : ''} />{loading ? 'Refreshing…' : 'Refresh'}</button></div>
      {error && <div className="shared-error" role="alert"><WifiOff size={20} /><div><strong>{tournament ? 'Updates are temporarily unavailable.' : 'This tournament couldn’t be opened.'}</strong><p>{messageOf(error)}</p>{tournament && <p>{receivedLabel ? `Showing the last data received at ${receivedLabel}.` : 'Showing the last tournament data received.'} New scores may not be shown yet.</p>}</div></div>}
      {!tournament ? <section className="shared-empty" aria-live="polite"><span><Trophy size={38} strokeWidth={1.4} /></span><h1>{loading ? 'Finding the action…' : 'Tournament unavailable'}</h1><p>{loading ? 'Loading the latest schedule and standings.' : error ? 'Check that you have the current viewer link, or ask the owner for a new one.' : 'The owner may have removed the tournament or replaced this viewer link.'}</p>{!loading && <button type="button" className="button button-secondary" onClick={refresh}><RefreshCw size={16} />Try again</button>}</section> : <Tournament readOnly store={store} onToast={notify} />}
      <footer className="shared-footer"><span>SIDELINE · BETTER TEAMS. BETTER GAMES.</span><a href="/">Open your clubhouse</a></footer>
    </main>
    <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast && <><span><Check size={15} /></span>{toast}</>}</div>
  </div>;
}
