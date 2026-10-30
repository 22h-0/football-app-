import { describe, expect, it } from 'vitest';
import { createTournament, formatLocalDateTime, formatTournament, getStandings, getTournamentStatus, isValidKickoff, parseLocalDateTime } from './tournament.js';

const makeTeams = (count) => Array.from({ length: count }, (_, i) => ({ id: `team-${i}`, name: `Team ${i + 1}`, players: [{ id: `player-${i}`, name: `Player ${i}`, skill: 70 + i }] }));
const create = (count = 3, options = {}) => createTournament({ name: 'Sunday cup', teams: makeTeams(count), ...options });

describe('round-robin scheduling', () => {
  it('schedules each pair exactly once, every team once at most per round, for 2–6 teams', () => {
    for (let count = 2; count <= 6; count += 1) {
      const tournament = create(count);
      expect(tournament.fixtures).toHaveLength(count * (count - 1) / 2);
      const pairs = tournament.fixtures.map((fixture) => [fixture.homeId, fixture.awayId].sort().join(':'));
      expect(new Set(pairs).size).toBe(pairs.length);
      for (const round of new Set(tournament.fixtures.map((fixture) => fixture.round))) {
        const roundTeams = tournament.fixtures.filter((fixture) => fixture.round === round).flatMap((fixture) => [fixture.homeId, fixture.awayId]);
        expect(new Set(roundTeams).size).toBe(roundTeams.length);
        expect(roundTeams).toHaveLength(count % 2 ? count - 1 : count);
      }
      for (const team of tournament.teams) expect(tournament.fixtures.filter((fixture) => fixture.homeId === team.id || fixture.awayId === team.id)).toHaveLength(count - 1);
      expect(tournament.fixtures.every((fixture) => fixture.homeScore === null && fixture.awayScore === null && fixture.kickoff === null)).toBe(true);
    }
  });

  it('creates return legs with the same pairings and reversed home/away labels', () => {
    for (let count = 2; count <= 6; count += 1) {
      const tournament = create(count, { doubleRoundRobin: true });
      expect(tournament.fixtures).toHaveLength(count * (count - 1));
      const half = tournament.fixtures.length / 2;
      for (let i = 0; i < half; i += 1) {
        const first = tournament.fixtures[i];
        const second = tournament.fixtures[i + half];
        expect(second.homeId).toBe(first.awayId);
        expect(second.awayId).toBe(first.homeId);
        expect(second.round).toBe(first.round + (count % 2 ? count : count - 1));
        expect(second.id).not.toBe(first.id);
      }
    }
  });

  it('creates sequential one-pitch kickoffs across midnight and preserves snapshots', () => {
    const teams = makeTeams(3);
    const tournament = create(3, { teams, startAt: '2026-10-27T23:40', matchMinutes: 20, breakMinutes: 5 });
    expect(tournament.fixtures.map((fixture) => fixture.kickoff)).toEqual(['2026-10-27T23:40', '2026-10-28T00:05', '2026-10-28T00:30']);
    teams[0].name = 'Changed';
    teams[0].players[0].name = 'Someone else';
    expect(tournament.teams[0].name).toBe('Team 1');
    expect(tournament.teams[0].players[0].name).toBe('Player 0');
  });

  it('rejects invalid names, duplicate teams, sizes, formats and durations', () => {
    for (const options of [{ name: ' ' }, { name: 'x'.repeat(61) }, { teams: makeTeams(1) }, { teams: makeTeams(7) }, { teams: [{ id: 'a', name: 'Blue' }, { id: 'a', name: 'Coral' }] }, { teams: [{ id: 'a', name: 'Blue' }, { id: 'b', name: 'blue ' }] }, { teams: [{ id: 'a', name: 'a'.repeat(31) }, { id: 'b', name: 'Coral' }] }, { matchMinutes: 0 }, { matchMinutes: 181 }, { matchMinutes: 1.5 }, { breakMinutes: -1 }, { breakMinutes: 121 }, { doubleRoundRobin: 'yes' }, { startAt: '2026-02-30T10:00' }]) {
      expect(() => create(3, options)).toThrow(RangeError);
    }
  });
});

describe('standings and tournament completion', () => {
  it('only counts fully saved scores, accepts 0–0, and awards 3/1/0', () => {
    const tournament = create(3);
    const [first, second] = tournament.fixtures;
    first.homeScore = 0; first.awayScore = 0;
    second.homeScore = 2; second.awayScore = null;
    expect(getStandings(tournament).reduce((sum, row) => sum + row.played, 0)).toBe(2);
    expect(getStandings(tournament).reduce((sum, row) => sum + row.points, 0)).toBe(2);
    second.awayScore = 0;
    const rows = getStandings(tournament);
    expect(rows.find((row) => row.teamId === second.homeId).won).toBe(1);
    expect(rows.find((row) => row.teamId === second.awayId).lost).toBe(1);
    expect(rows.reduce((sum, row) => sum + row.points, 0)).toBe(5);
    expect(rows.reduce((sum, row) => sum + row.goalsFor, 0)).toBe(2);
    expect(rows.reduce((sum, row) => sum + row.goalsAgainst, 0)).toBe(2);
    expect(getTournamentStatus(tournament)).toMatchObject({ played: 2, total: 3, complete: false, winners: [] });
  });

  it('ranks by points, then goal difference, then goals scored', () => {
    const tournament = create(3);
    const results = { 'team-0:team-1': [2, 1], 'team-0:team-2': [0, 1], 'team-1:team-2': [3, 2] };
    for (const fixture of tournament.fixtures) {
      const pair = [fixture.homeId, fixture.awayId].sort();
      const score = results[pair.join(':')];
      [fixture.homeScore, fixture.awayScore] = fixture.homeId === pair[0] ? score : [...score].reverse();
    }
    expect(getStandings(tournament).map((row) => [row.teamId, row.points, row.goalDifference, row.goalsFor])).toEqual([
      ['team-1', 3, 0, 4], ['team-2', 3, 0, 3], ['team-0', 3, 0, 2],
    ]);
    expect(getTournamentStatus(tournament).winners.map((row) => row.teamId)).toEqual(['team-1']);
  });

  it('shares exact ties and declares joint winners only after every fixture is scored', () => {
    const tournament = create(3);
    expect(getTournamentStatus(tournament).winners).toEqual([]);
    for (const fixture of tournament.fixtures) { fixture.homeScore = 0; fixture.awayScore = 0; }
    expect(getStandings(tournament).map((row) => row.rank)).toEqual([1, 1, 1]);
    expect(getTournamentStatus(tournament)).toMatchObject({ played: 3, total: 3, complete: true });
    expect(getTournamentStatus(tournament).winners).toHaveLength(3);
    expect(formatTournament(tournament)).toContain('Joint winners: Team 1, Team 2, Team 3');
  });

  it('recomputes corrections without mutating tournaments and removes completion when a score is cleared', () => {
    const tournament = create(2);
    const fixture = tournament.fixtures[0];
    fixture.homeScore = 1; fixture.awayScore = 0;
    const before = structuredClone(tournament);
    expect(getTournamentStatus(tournament).winners[0].teamId).toBe(fixture.homeId);
    getStandings(tournament);
    expect(tournament).toEqual(before);
    fixture.homeScore = 0; fixture.awayScore = 2;
    expect(getTournamentStatus(tournament).winners[0].teamId).toBe(fixture.awayId);
    fixture.homeScore = null;
    expect(getTournamentStatus(tournament)).toMatchObject({ played: 0, complete: false, winners: [] });
    expect(getStandings(tournament).every((row) => row.played === 0)).toBe(true);
  });

  it('uses shared competition ranks and ignores negative, fractional or excessively large scores', () => {
    const tournament = create(4);
    for (const fixture of tournament.fixtures) {
      if (fixture.homeId === 'team-3' || fixture.awayId === 'team-3') {
        fixture.homeScore = fixture.homeId === 'team-3' ? 0 : 1;
        fixture.awayScore = fixture.awayId === 'team-3' ? 0 : 1;
      } else { fixture.homeScore = 0; fixture.awayScore = 0; }
    }
    expect(getStandings(tournament).map((row) => row.rank)).toEqual([1, 1, 1, 4]);
    for (const bad of [-1, 0.5, 100, '1', NaN]) {
      tournament.fixtures[0].homeScore = bad;
      expect(getTournamentStatus(tournament).complete).toBe(false);
    }
  });

  it('exports readable standings, fixtures, kickoff times and match progress', () => {
    const tournament = create(2, { startAt: '2026-10-27T19:00' });
    let text = formatTournament(tournament);
    expect(text).toContain('0/1 matches played');
    expect(text).toContain('Team 1 vs Team 2 · 2026-10-27 19:00');
    expect(text).toContain('Tournament in progress');
    Object.assign(tournament.fixtures[0], { homeScore: 3, awayScore: 0 });
    text = formatTournament(tournament);
    expect(text).toContain('Team 1 3–0 Team 2');
    expect(text).toContain('Winner: Team 1');
  });
});

describe('local scheduling dates', () => {
  it('round-trips valid dates and normalizes unscheduled values', () => {
    expect(formatLocalDateTime(parseLocalDateTime('2028-02-29T09:05'))).toBe('2028-02-29T09:05');
    for (const value of ['', null, undefined]) expect(parseLocalDateTime(value)).toBeNull();
    expect(isValidKickoff('2026-10-27T00:00')).toBe(true);
    expect(isValidKickoff('')).toBe(false);
  });

  it('rejects rollover dates, invalid times, UTC suffixes and non-string values', () => {
    for (const value of ['2026-02-29T09:00', '2026-13-01T09:00', '2026-00-01T09:00', '2026-10-00T09:00', '2026-10-27T24:00', '2026-10-27T09:60', '2026-10-27T09:00Z', '2026-10-27', 42]) {
      expect(() => parseLocalDateTime(value)).toThrow(RangeError);
      expect(isValidKickoff(value)).toBe(false);
    }
  });
});
