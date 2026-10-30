/**
 * Balance skill totals while keeping team sizes within one player.
 * Tiny search spaces are solved exactly. Larger groups use seeded multi-start
 * greedy allocation, then one-for-one and two-for-two exchanges. The latter is
 * a heuristic: equal totals may be impossible and global optimality is not
 * promised for large groups. Player objects and the input array are not mutated.
 */
export function balanceTeams(players, teamCount, seed = Math.floor(Math.random() * 2 ** 32)) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 100) {
    throw new RangeError('Choose between 2 and 100 players.');
  }
  if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > Math.min(6, players.length)) {
    throw new RangeError('Choose between 2 and 6 teams, with at least one player per team.');
  }
  if (players.some((player) => !player || !Number.isInteger(player.skill) || player.skill < 1 || player.skill > 100)) {
    throw new RangeError('Every player needs a whole-number skill level from 1 to 100.');
  }

  const random = seededRandom(seed);
  const capacities = Array.from({ length: teamCount }, (_, index) =>
    Math.floor(players.length / teamCount) + (index < players.length % teamCount ? 1 : 0));
  const total = players.reduce((sum, player) => sum + player.skill, 0);
  const lowerBound = total % teamCount === 0 ? 0 : 1;
  let bestTeams;
  let bestScore = [Infinity, Infinity];

  for (let attempt = 0; attempt < (players.length <= 40 ? 14 : 8); attempt += 1) {
    const teams = capacities.map(() => []);
    const totals = capacities.map(() => 0);
    const order = players.map((player) => ({ player, priority: player.skill + (attempt ? random() * 50 : 0) }));
    order.sort((a, b) => b.priority - a.priority);
    for (const { player } of order) {
      const available = teams.map((team, index) => index).filter((index) => teams[index].length < capacities[index]);
      const lowestTotal = Math.min(...available.map((index) => totals[index]));
      const candidates = available.filter((index) => totals[index] === lowestTotal);
      const index = candidates[Math.floor(random() * candidates.length)];
      teams[index].push(player);
      totals[index] += player.skill;
    }
    improve(teams, totals, lowerBound);
    const candidateScore = score(totals);
    if (better(candidateScore, bestScore)) {
      bestScore = candidateScore;
      bestTeams = teams.map((team) => [...team]);
    }
    if (bestScore[0] === lowerBound) break;
  }

  // The estimate counts partitions rather than labelled team permutations.
  // A bounded exhaustive pass guarantees optimality for small selections.
  if (bestScore[0] !== lowerBound && players.length <= 20 && partitionCount(capacities) <= 160_000) {
    const sorted = [...players].sort((a, b) => b.skill - a.skill);
    const teams = capacities.map(() => []);
    const totals = capacities.map(() => 0);
    let optimal = false;
    const search = (position) => {
      if (optimal) return;
      if (position === sorted.length) {
        const candidateScore = score(totals);
        if (better(candidateScore, bestScore)) {
          bestScore = candidateScore;
          bestTeams = teams.map((team) => [...team]);
          optimal = bestScore[0] === lowerBound;
        }
        return;
      }
      const seen = new Set();
      for (let index = 0; index < teamCount; index += 1) {
        if (teams[index].length === capacities[index]) continue;
        // Teams with identical capacity, occupancy, and total are equivalent
        // for all future assignments, even if their players are different.
        const state = `${capacities[index]}:${teams[index].length}:${totals[index]}`;
        if (seen.has(state)) continue;
        seen.add(state);
        const player = sorted[position];
        teams[index].push(player);
        totals[index] += player.skill;
        search(position + 1);
        totals[index] -= player.skill;
        teams[index].pop();
      }
    };
    search(0);
  }

  return bestTeams.map((team) => team.sort((a, b) => b.skill - a.skill || String(a.name ?? '').localeCompare(String(b.name ?? ''))));
}

export function getBalanceStats(teams) {
  const totals = teams.map((team) => team.reduce((sum, player) => sum + player.skill, 0));
  const totalSkill = totals.reduce((sum, value) => sum + value, 0);
  const spread = totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
  const averageTotal = teams.length ? totalSkill / teams.length : 0;
  return {
    totals,
    totalSkill,
    spread,
    averages: teams.map((team, index) => team.length ? Math.round(totals[index] / team.length) : 0),
    // A descriptive similarity score, not a probability of winning.
    balance: averageTotal ? Math.max(0, Math.round((1 - spread / averageTotal) * 100)) : 100,
  };
}

function seededRandom(seed) {
  let value = Number(seed) >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function score(totals) {
  return [Math.max(...totals) - Math.min(...totals), totals.reduce((sum, total) => sum + total * total, 0)];
}

function better(candidate, current) {
  return candidate[0] < current[0] || (candidate[0] === current[0] && candidate[1] < current[1]);
}

function improve(teams, totals, lowerBound) {
  let current = score(totals);
  for (let iteration = 0; iteration < 100 && current[0] !== lowerBound; iteration += 1) {
    let next = current;
    let exchange = null;
    const consider = (a, b, ai, bi, difference) => {
      totals[a] -= difference;
      totals[b] += difference;
      const candidate = score(totals);
      if (better(candidate, next)) {
        next = candidate;
        exchange = { a, b, ai, bi, difference };
      }
      totals[a] += difference;
      totals[b] -= difference;
    };

    for (let a = 0; a < teams.length; a += 1) {
      for (let b = a + 1; b < teams.length; b += 1) {
        for (let i = 0; i < teams[a].length; i += 1) {
          for (let j = 0; j < teams[b].length; j += 1) {
            consider(a, b, [i], [j], teams[a][i].skill - teams[b][j].skill);
          }
        }
      }
    }

    if (!exchange) {
      // Escape single-swap local minima with pairs. Sorted pair sums let us
      // look up the closest exchange without a quartic brute-force search.
      const pairs = teams.map((team) => {
        const result = [];
        for (let i = 0; i < team.length; i += 1) {
          for (let j = i + 1; j < team.length; j += 1) {
            result.push({ indices: [i, j], sum: team[i].skill + team[j].skill });
          }
        }
        return result.sort((a, b) => a.sum - b.sum);
      });
      for (let a = 0; a < teams.length; a += 1) {
        for (let b = a + 1; b < teams.length; b += 1) {
          for (const pairA of pairs[a]) {
            const target = pairA.sum - (totals[a] - totals[b]) / 2;
            let low = 0;
            let high = pairs[b].length;
            while (low < high) {
              const middle = Math.floor((low + high) / 2);
              if (pairs[b][middle].sum < target) low = middle + 1;
              else high = middle;
            }
            for (const index of [low - 1, low]) {
              const pairB = pairs[b][index];
              if (pairB) consider(a, b, pairA.indices, pairB.indices, pairA.sum - pairB.sum);
            }
          }
        }
      }
    }

    if (!exchange) return;
    const { a, b, ai, bi, difference } = exchange;
    ai.forEach((index, offset) => {
      const otherIndex = bi[offset];
      [teams[a][index], teams[b][otherIndex]] = [teams[b][otherIndex], teams[a][index]];
    });
    totals[a] -= difference;
    totals[b] += difference;
    current = next;
  }
}

function partitionCount(capacities) {
  const factorial = (number) => {
    let result = 1;
    for (let i = 2; i <= number; i += 1) result *= i;
    return result;
  };
  const frequencies = capacities.reduce((counts, capacity) => {
    counts[capacity] = (counts[capacity] ?? 0) + 1;
    return counts;
  }, {});
  return factorial(capacities.reduce((sum, value) => sum + value, 0)) /
    capacities.reduce((product, capacity) => product * factorial(capacity), 1) /
    Object.values(frequencies).reduce((product, count) => product * factorial(count), 1);
}
