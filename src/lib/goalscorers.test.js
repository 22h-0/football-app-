import { describe, expect, it } from 'vitest';
import { getScorerCoverage, getTopScorers, normalizeScorers } from './goalscorers.js';

const rosterTeams = [
  { id: 'blue', name: 'Blue', players: [{ id: 'alex', name: 'Alex', skill: 80 }, { id: 'other-alex', name: 'Alex', skill: 75 }] },
  { id: 'red', name: 'Red', players: [{ id: 'sam', name: 'Sam', skill: 70 }] },
  { id: 'green', name: 'Green', players: [] },
];
const fixture = (options = {}) => ({ id: 'match', homeId: 'blue', awayId: 'red', homeScore: 3, awayScore: 1, ...options });
const tournament = (fixtures = [], teams = rosterTeams) => ({ teams, fixtures });
const entry = (options = {}) => ({ teamId: 'blue', playerId: 'alex', name: 'Spoofed name', goals: 2, ...options });

describe('goalscorer validation', () => {
  it('canonicalizes roster names and does not mutate the input', () => {
    const entries = [entry(), entry({ teamId: 'red', playerId: 'sam', goals: 1 })];
    const before = structuredClone(entries);
    expect(normalizeScorers(tournament(), fixture(), entries)).toEqual([
      { teamId: 'blue', playerId: 'alex', name: 'Alex', goals: 2 },
      { teamId: 'red', playerId: 'sam', name: 'Sam', goals: 1 },
    ]);
    expect(entries).toEqual(before);
  });
  it('permits legacy empty attribution and requires saved scores for goals', () => {
    const match = fixture({ homeScore: null, awayScore: null });
    expect(normalizeScorers(tournament(), match)).toEqual([]);
    expect(normalizeScorers(tournament(), match, [])).toEqual([]);
    expect(() => normalizeScorers(tournament(), match, [entry()])).toThrow(/Save both/);
  });
  it('requires fixture teams, squad members and positive integer goals', () => {
    for (const invalid of [entry({ teamId: 'green' }), entry({ playerId: 'sam' }), entry({ playerId: null }), entry({ goals: 0 }), entry({ goals: 1.5 }), entry({ goals: -1 }), entry({ goals: 100 }), entry({ goals: '1' })]) {
      expect(() => normalizeScorers(tournament(), fixture(), [invalid])).toThrow(RangeError);
    }
    expect(() => normalizeScorers(tournament(), fixture(), null)).toThrow(RangeError);
    expect(() => normalizeScorers(tournament(), fixture(), Array(199).fill(entry()))).toThrow(RangeError);
  });
  it('rejects duplicate IDs but distinguishes same-name roster players', () => {
    expect(() => normalizeScorers(tournament(), fixture(), [entry({ goals: 1 }), entry({ goals: 1 })])).toThrow(/one entry/);
    expect(normalizeScorers(tournament(), fixture(), [entry(), entry({ playerId: 'other-alex', goals: 1 })])).toHaveLength(2);
  });
  it('rejects attribution above the saved team score and any goal in a 0–0', () => {
    expect(() => normalizeScorers(tournament(), fixture(), [entry(), entry({ playerId: 'other-alex', goals: 2 })])).toThrow(/cannot exceed/);
    expect(() => normalizeScorers(tournament(), fixture({ homeScore: 0, awayScore: 0 }), [entry({ goals: 1 })])).toThrow(/cannot exceed/);
  });
  it('normalizes custom names and rejects aliases and invalid names', () => {
    const cup = tournament([], [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }]);
    const custom = entry({ playerId: null, name: '  Ａlex\t  Morgan  ' });
    expect(normalizeScorers(cup, fixture(), [custom])[0].name).toBe('Alex Morgan');
    expect(() => normalizeScorers(cup, fixture(), [custom, entry({ playerId: null, name: 'alex morgan', goals: 1 })])).toThrow(/one entry/);
    for (const invalid of [entry({ playerId: null, name: ' ' }), entry({ playerId: null, name: 'a'.repeat(41) }), entry({ playerId: 'arbitrary', name: 'Alex' })]) expect(() => normalizeScorers(cup, fixture(), [invalid])).toThrow(/name/);
  });
});

describe('goalscorer totals', () => {
  it('aggregates matches and shares ranks 1,1,3 for equal totals', () => {
    const cup = tournament([
      fixture({ scorers: [entry(), entry({ teamId: 'red', playerId: 'sam', goals: 1 }), entry({ playerId: 'other-alex', goals: 1 })] }),
      fixture({ id: 'return', homeId: 'red', awayId: 'blue', homeScore: 2, awayScore: 1, scorers: [entry({ goals: 1 }), entry({ teamId: 'red', playerId: 'sam', goals: 2 })] }),
    ]);
    const before = structuredClone(cup);
    expect(getTopScorers(cup).map((row) => [row.playerId, row.goals, row.rank])).toEqual([['alex', 3, 1], ['sam', 3, 1], ['other-alex', 1, 3]]);
    expect(getScorerCoverage(cup)).toEqual({ totalGoals: 7, recordedGoals: 7, unassignedGoals: 0, complete: true });
    expect(cup).toEqual(before);
  });
  it('keeps teams separate and merges case variants within the same team', () => {
    const teams = [{ id: 'blue', name: 'Blue' }, { id: 'red', name: 'Red' }];
    const cup = tournament([
      fixture({ scorers: [entry({ playerId: null, name: ' Alex  Morgan ', goals: 1 }), entry({ teamId: 'red', playerId: null, name: 'Alex Morgan', goals: 1 })] }),
      fixture({ homeId: 'red', awayId: 'blue', homeScore: 0, awayScore: 1, scorers: [entry({ playerId: null, name: 'alex morgan', goals: 1 })] }),
    ], teams);
    expect(getTopScorers(cup).map((row) => [row.teamId, row.goals])).toEqual([['blue', 2], ['red', 1]]);
  });
  it('counts unknown goals but skips invalid or unplayed attribution', () => {
    const cup = tournament([
      fixture({ scorers: [entry({ goals: 1 }), entry({ teamId: 'red', playerId: 'sam', goals: 2 })] }),
      fixture({ id: 'legacy', homeScore: 2, awayScore: 0 }),
      fixture({ homeScore: null, awayScore: null, scorers: [entry()] }),
    ]);
    expect(getTopScorers(cup)).toEqual([]);
    expect(getScorerCoverage(cup)).toEqual({ totalGoals: 6, recordedGoals: 0, unassignedGoals: 6, complete: false });
  });
  it('recomputes corrections and clearing without stale goals', () => {
    const match = fixture({ scorers: [entry()] });
    const cup = tournament([match]);
    expect(getTopScorers(cup)[0].goals).toBe(2);
    match.homeScore = 1;
    expect(getTopScorers(cup)).toEqual([]);
    expect(getScorerCoverage(cup).unassignedGoals).toBe(2);
    match.homeScore = null; match.awayScore = null;
    expect(getScorerCoverage(cup)).toEqual({ totalGoals: 0, recordedGoals: 0, unassignedGoals: 0, complete: true });
  });
  it('handles empty tournaments and invalid team references', () => {
    expect(getTopScorers(tournament())).toEqual([]);
    expect(getScorerCoverage(tournament())).toEqual({ totalGoals: 0, recordedGoals: 0, unassignedGoals: 0, complete: true });
    expect(getScorerCoverage(tournament([fixture({ homeScore: -1 }), fixture({ awayId: 'missing' })])).totalGoals).toBe(0);
  });
});
