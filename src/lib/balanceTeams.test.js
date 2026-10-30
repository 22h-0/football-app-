import { describe, expect, it } from 'vitest';
import { balanceTeams, getBalanceStats } from './balanceTeams';

const roster = (skills) => skills.map((skill, index) => ({ id: `p${index}`, name: `Player ${index + 1}`, skill }));
const spread = (teams) => getBalanceStats(teams).spread;

function exhaustiveSpread(players, count) {
  const capacities = Array.from({ length: count }, (_, index) => Math.floor(players.length / count) + (index < players.length % count ? 1 : 0));
  let minimum = Infinity;
  const totals = capacities.map(() => 0);
  const sizes = capacities.map(() => 0);
  const search = (position) => {
    if (position === players.length) {
      minimum = Math.min(minimum, Math.max(...totals) - Math.min(...totals));
      return;
    }
    for (let i = 0; i < count; i += 1) {
      if (sizes[i] === capacities[i]) continue;
      sizes[i] += 1;
      totals[i] += players[position].skill;
      search(position + 1);
      sizes[i] -= 1;
      totals[i] -= players[position].skill;
    }
  };
  search(0);
  return minimum;
}

describe('balanceTeams', () => {
  it('finds equal skill totals instead of simply splitting the sorted roster', () => {
    const teams = balanceTeams(roster([95, 90, 85, 80, 75, 70, 65, 60]), 2, 17);
    expect(getBalanceStats(teams).totals).toEqual([310, 310]);
  });

  it('handles uneven counts while keeping all players exactly once', () => {
    const players = roster([100, 98, 92, 86, 82, 70, 66, 45, 31, 18, 5]);
    const teams = balanceTeams(players, 3, 4);
    expect(teams.map((team) => team.length)).toEqual([4, 4, 3]);
    expect(teams.flat().map((player) => player.id).sort()).toEqual(players.map((player) => player.id).sort());
    expect(spread(teams)).toBe(exhaustiveSpread(players, 3));
  });

  it('returns the global optimum for adversarial small groups', () => {
    for (const skills of [[100, 100, 100, 1, 1], [29, 26, 24, 22, 20, 19, 15, 13], [100, 1, 1, 1, 1, 1, 1], [17, 17, 17, 17, 17, 17, 17, 17]]) {
      for (const count of [2, 3]) {
        const players = roster(skills);
        expect(spread(balanceTeams(players, count, 22))).toBe(exhaustiveSpread(players, count));
      }
    }
  });

  it('is repeatable for a given seed and does not mutate inputs', () => {
    const players = roster([90, 83, 79, 75, 72, 65, 62, 51, 40, 30]);
    const before = structuredClone(players);
    const first = balanceTeams(players, 3, 123);
    expect(first).toEqual(balanceTeams(players, 3, 123));
    expect(players).toEqual(before);
    first.flat().forEach((player) => expect(players).toContain(player));
  });

  it('preserves size and membership invariants for 2–6 teams and up to 100 players', () => {
    for (let size = 2; size <= 100; size += 7) {
      const players = roster(Array.from({ length: size }, (_, index) => ((index * 37 + size * 11) % 100) + 1));
      for (let count = 2; count <= Math.min(size, 6); count += 1) {
        const teams = balanceTeams(players, count, size);
        const lengths = teams.map((team) => team.length);
        expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(1);
        expect(teams.flat()).toHaveLength(size);
        expect(new Set(teams.flat().map((player) => player.id)).size).toBe(size);
      }
    }
  });

  it('balances six teams without needing six players per team', () => {
    const players = roster([70, 70, 70, 70, 70, 70]);
    expect(balanceTeams(players, 6, 1).map((team) => team.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(spread(balanceTeams(players, 6, 1))).toBe(0);
  });

  it('validates bounds and skill values', () => {
    expect(() => balanceTeams([], 2)).toThrow(RangeError);
    expect(() => balanceTeams(roster([30, 40]), 3)).toThrow(RangeError);
    expect(() => balanceTeams(roster([30, 40]), 1)).toThrow(RangeError);
    expect(() => balanceTeams(roster([0, 100]), 2)).toThrow(RangeError);
    expect(() => balanceTeams(roster([1.5, 100]), 2)).toThrow(RangeError);
    expect(() => balanceTeams(roster(Array(101).fill(50)), 2)).toThrow(RangeError);
  });
});

describe('getBalanceStats', () => {
  it('reports totals, averages, spread, and a clamped balance score', () => {
    expect(getBalanceStats([roster([70, 80]), roster([60, 90])])).toEqual({ totals: [150, 150], totalSkill: 300, spread: 0, averages: [75, 75], balance: 100 });
    expect(getBalanceStats([])).toEqual({ totals: [], totalSkill: 0, spread: 0, averages: [], balance: 100 });
  });
});
