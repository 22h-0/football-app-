import { Medal, Target, Trophy } from 'lucide-react';
import { getScorerCoverage, getTopScorers } from '../lib/goalscorers.js';

export default function TopScorers({ tournament, complete }) {
  const rows = getTopScorers(tournament);
  const coverage = getScorerCoverage(tournament);
  const final = complete && coverage.complete && rows.length > 0;
  const leaders = rows.filter((row) => row.rank === 1);
  return <section className="top-scorers-section" aria-labelledby="top-scorers-heading">
    <div className="section-heading"><div><h2 id="top-scorers-heading">Golden Boot<Target size={18} /></h2><p>Every finish counts. The tournament’s leading goalscorers.</p></div><span className="live-table"><span className="status-dot" />{final ? 'FINAL RANKINGS' : 'TOP SCORERS'}</span></div>
    {final && <div className="golden-boot-banner" role="status"><Trophy size={24} /><div><span>{leaders.length > 1 ? 'SHARED GOLDEN BOOT' : 'GOLDEN BOOT WINNER'}</span><h3>{leaders.map((player) => player.name).join(' & ')}</h3><p>{leaders[0].goals} goal{leaders[0].goals === 1 ? '' : 's'} · Every match scored. Every goal assigned.</p></div></div>}
    <div className="scorer-coverage"><span>{coverage.recordedGoals} of {coverage.totalGoals} goal{coverage.totalGoals === 1 ? '' : 's'} assigned</span>{coverage.unassignedGoals > 0 && <strong>{coverage.unassignedGoals} still unassigned</strong>}</div>
    {rows.length ? <ol className="top-scorers-list scorers-table" aria-label="Top goalscorers">{rows.map((row) => <li key={row.key}><span aria-label={`Rank ${row.rank}`} className={`scorer-rank ${row.rank === 1 ? 'scorer-leading-rank' : ''}`}>{row.rank === 1 ? <Medal size={18} aria-label="First place" /> : row.rank}</span><div><strong>{row.name}</strong><span>{row.teamName}</span></div><span className="scorer-total-goals"><strong>{row.goals}</strong><span>GOALS</span></span></li>)}</ol> : <div className="scorers-empty"><Target size={25} /><h3>{complete && coverage.totalGoals === 0 ? 'No goals. All heart.' : 'The Golden Boot race starts here.'}</h3><p>{complete && coverage.totalGoals === 0 ? 'The tournament finished without a goal. No Golden Boot is awarded.' : 'Goalscorers appear here when they are added to match results.'}</p></div>}
    <p className="standings-rule">{coverage.unassignedGoals > 0 ? 'Some goals still need a scorer. Rankings remain provisional until all match results and goalscorers are recorded.' : final ? 'Equal goal totals share a position and the Golden Boot. Team names keep players with the same name distinct.' : 'Ranked by recorded goals. Equal totals share a position. The Golden Boot is confirmed after all matches are scored and every goal is assigned.'}</p>
  </section>;
}
