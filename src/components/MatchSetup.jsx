import { ArrowRight, Check, ChevronLeft, ChevronRight, ShieldCheck, SlidersHorizontal, Users, Zap } from 'lucide-react';

export function PitchIllustration() {
  return <div className="pitch-illustration" aria-hidden="true"><div className="pitch-outline"><div className="pitch-half" /><div className="pitch-circle" /><div className="pitch-box pitch-box-left" /><div className="pitch-box pitch-box-right" /><span className="pitch-player p1" /><span className="pitch-player p2" /><span className="pitch-player p3" /><span className="pitch-player p4" /><span className="pitch-player p5" /><span className="pitch-player opponent p6" /><span className="pitch-player opponent p7" /><span className="pitch-player opponent p8" /><span className="pitch-player opponent p9" /><span className="pitch-player opponent p10" /></div><div className="pitch-tag"><span className="status-dot" />ALL GAME. NO GUESSWORK.</div></div>;
}

export function Steps({ generated = false }) {
  return <ol className="workflow-steps" aria-label="Team generation steps"><li className="complete"><span><Check size={12} strokeWidth={3} /></span>Your roster</li><li className={!generated ? 'current' : 'complete'}><span>{generated ? <Check size={12} strokeWidth={3} /> : '2'}</span>Today’s lineup</li><li className={generated ? 'current' : ''}><span>3</span>Game on</li></ol>;
}

export default function MatchSetup({ selectedPlayers, teamCount, setTeamCount, onGenerate }) {
  const count = selectedPlayers.length;
  const minSize = Math.floor(count / teamCount);
  const maxSize = Math.ceil(count / teamCount);
  const canGenerate = count >= teamCount;
  const average = count ? Math.round(selectedPlayers.reduce((sum, player) => sum + player.skill, 0) / count) : '—';
  return <aside className="match-config" aria-labelledby="match-config-heading">
    <div className="config-heading"><span className="config-icon"><SlidersHorizontal size={18} /></span><h2 id="match-config-heading">Set up your match</h2></div>
    <div className="config-body">
      <div className="config-label">NUMBER OF TEAMS</div>
      <div className="team-stepper"><button className="stepper-button" aria-label="Fewer teams" disabled={teamCount <= 2} onClick={() => setTeamCount(teamCount - 1)}><ChevronLeft size={20} /></button><span><strong>{teamCount}</strong><span>teams</span></span><button className="stepper-button" aria-label="More teams" disabled={teamCount >= 6} onClick={() => setTeamCount(teamCount + 1)}><ChevronRight size={20} /></button></div>
      <div className="config-divider" />
      <dl className="match-stats"><div><dt><Users size={15} />Players available</dt><dd>{count}</dd></div><div><dt>Players per team</dt><dd>{count ? (minSize === maxSize ? minSize : `${minSize}–${maxSize}`) : '—'}</dd></div><div><dt>Average skill</dt><dd>{average}<span> / 100</span></dd></div></dl>
      <div className="balance-note"><ShieldCheck size={18} /><p><strong>Fair play, built in.</strong>We balance total skill and keep team sizes as even as possible.</p></div>
      <button className="button button-primary generate-button" disabled={!canGenerate} onClick={onGenerate}><Zap size={18} fill="currentColor" />Generate teams<ArrowRight size={18} /></button>
      <p className="generate-hint">{canGenerate ? 'Less debating. More football.' : `Select at least ${teamCount} players to get started.`}</p>
    </div>
    <div className="config-footer"><span className="tiny-ball">✦</span>Made for the love of the game.</div>
  </aside>;
}
