import { getTopScorers, getScorerCoverage } from './goalscorers.js';

/** Round-robin fixtures and football standings. Dates are local, minute precision. */
function id(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

export function parseLocalDateTime(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new RangeError('Use a valid local date and time.');
  }
  const [year, month, day, hour, minute] = value.match(/\d+/g).map(Number);
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new RangeError('Use a valid local date and time.');
  }
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) {
    throw new RangeError('Use a valid local date and time.');
  }
  return date;
}

export function isValidKickoff(value) {
  try { return parseLocalDateTime(value) !== null; } catch { return false; }
}

export function formatLocalDateTime(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new RangeError('Use a valid date.');
  const pad = (number) => String(number).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isValidScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= 99;
}

export function isPlayed(fixture) {
  return isValidScore(fixture.homeScore) && isValidScore(fixture.awayScore);
}

export function createTournament({ name, teams, doubleRoundRobin = false, startAt, matchMinutes = 20, breakMinutes = 5 }) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new RangeError('Enter a tournament name between 1 and 60 characters.');
  if (!Array.isArray(teams) || teams.length < 2 || teams.length > 6) throw new RangeError('Choose between 2 and 6 teams.');
  if (teams.some((team) => !team || typeof team.id !== 'string' || !team.id || team.id.length > 100 || typeof team.name !== 'string' || !team.name.trim() || team.name.trim().length > 30)) {
    throw new RangeError('Every team needs an ID and a name between 1 and 30 characters.');
  }
  if (new Set(teams.map((team) => team.id)).size !== teams.length) throw new RangeError('Each team needs a unique ID.');
  if (new Set(teams.map((team) => team.name.trim().toLocaleLowerCase())).size !== teams.length) throw new RangeError('Give each team a different name.');
  if (typeof doubleRoundRobin !== 'boolean') throw new RangeError('Choose a valid round-robin format.');
  if (!Number.isInteger(matchMinutes) || matchMinutes < 1 || matchMinutes > 180) throw new RangeError('Match duration must be between 1 and 180 whole minutes.');
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 120) throw new RangeError('Break duration must be between 0 and 120 whole minutes.');
  if (teams.some((team) => team.players !== undefined && (!Array.isArray(team.players) || team.players.length > 100))) throw new RangeError('A team roster can contain up to 100 players.');
  const start = parseLocalDateTime(startAt);
  const snapshots = teams.map((team) => ({
    id: team.id,
    name: team.name.trim(),
    players: (team.players ?? []).map((player) => ({ ...player })),
  }));

  // The circle method rotates every team except the first. A null slot is a
  // bye, never a fixture. Each team plays at most once per round.
  const rotation = snapshots.map((team) => team.id);
  if (rotation.length % 2) rotation.push(null);
  const firstLeg = [];
  for (let round = 1; round < rotation.length; round += 1) {
    for (let pair = 0; pair < rotation.length / 2; pair += 1) {
      const a = rotation[pair];
      const b = rotation[rotation.length - 1 - pair];
      if (a === null || b === null) continue;
      // Alternating orientation distributes home/away designations; these
      // are labels only because the timetable assumes one shared pitch.
      const reverse = (round + pair) % 2 === 0;
      firstLeg.push({ round, homeId: reverse ? b : a, awayId: reverse ? a : b });
    }
    rotation.splice(1, 0, rotation.pop());
  }
  const roundsPerLeg = rotation.length - 1;
  const matches = doubleRoundRobin
    ? [...firstLeg, ...firstLeg.map((fixture) => ({ round: fixture.round + roundsPerLeg, homeId: fixture.awayId, awayId: fixture.homeId }))]
    : firstLeg;
  const fixtures = matches.map((fixture, index) => ({
    id: id('fixture'),
    ...fixture,
    kickoff: start ? formatLocalDateTime(new Date(start.getTime() + index * (matchMinutes + breakMinutes) * 60_000)) : null,
    homeScore: null,
    awayScore: null,
  }));
  // Reject a datetime overflow instead of creating an unusable saved fixture.
  if (fixtures.some((fixture) => fixture.kickoff !== null && !isValidKickoff(fixture.kickoff))) throw new RangeError('The schedule extends beyond the supported date range.');
  return {
    id: id('tournament'),
    name: name.trim(),
    createdAt: new Date().toISOString(),
    teams: snapshots,
    fixtures,
    settings: { doubleRoundRobin, startAt: start ? formatLocalDateTime(start) : null, matchMinutes, breakMinutes },
  };
}

function sameStanding(a, b) {
  return a.points === b.points && a.goalDifference === b.goalDifference && a.goalsFor === b.goalsFor;
}

export function getStandings(tournament) {
  const rows = tournament.teams.map((team) => ({ teamId: team.id, name: team.name, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, rank: 0 }));
  const byId = new Map(rows.map((row) => [row.teamId, row]));
  for (const fixture of tournament.fixtures) {
    if (!isPlayed(fixture)) continue;
    const home = byId.get(fixture.homeId);
    const away = byId.get(fixture.awayId);
    if (!home || !away || home === away) continue;
    home.played += 1;
    away.played += 1;
    home.goalsFor += fixture.homeScore;
    home.goalsAgainst += fixture.awayScore;
    away.goalsFor += fixture.awayScore;
    away.goalsAgainst += fixture.homeScore;
    if (fixture.homeScore === fixture.awayScore) {
      home.drawn += 1;
      away.drawn += 1;
      home.points += 1;
      away.points += 1;
    } else {
      const winner = fixture.homeScore > fixture.awayScore ? home : away;
      const loser = winner === home ? away : home;
      winner.won += 1;
      winner.points += 3;
      loser.lost += 1;
    }
  }
  for (const row of rows) row.goalDifference = row.goalsFor - row.goalsAgainst;
  rows.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name) || a.teamId.localeCompare(b.teamId));
  rows.forEach((row, index) => { row.rank = index && sameStanding(row, rows[index - 1]) ? rows[index - 1].rank : index + 1; });
  return rows;
}

export function getTournamentStatus(tournament) {
  const total = tournament.fixtures.length;
  const played = tournament.fixtures.filter(isPlayed).length;
  const complete = total > 0 && played === total;
  const winners = complete ? getStandings(tournament).filter((row) => row.rank === 1) : [];
  return { played, total, complete, winners };
}

export function formatTournament(tournament) {
  const standings = getStandings(tournament);
  const status = getTournamentStatus(tournament);
  const names = new Map(tournament.teams.map((team) => [team.id, team.name]));
  const lines = [`🏆 ${tournament.name}`, `${tournament.settings.doubleRoundRobin ? 'Double' : 'Single'} round-robin · ${status.played}/${status.total} matches played`, '', 'STANDINGS', 'Rank · Team · P / W / D / L · GF:GA · GD · Pts'];
  for (const row of standings) lines.push(`${row.rank}. ${row.name} · ${row.played} / ${row.won} / ${row.drawn} / ${row.lost} · ${row.goalsFor}:${row.goalsAgainst} · ${row.goalDifference > 0 ? '+' : ''}${row.goalDifference} · ${row.points} pts`);
  lines.push('', 'FIXTURES & RESULTS');
  let round = null;
  for (const fixture of tournament.fixtures) {
    if (fixture.round !== round) { round = fixture.round; lines.push(`Round ${round}`); }
    const score = isPlayed(fixture) ? `${fixture.homeScore}–${fixture.awayScore}` : 'vs';
    const kickoff = fixture.kickoff ? ` · ${fixture.kickoff.replace('T', ' ')}` : '';
    lines.push(`${names.get(fixture.homeId)} ${score} ${names.get(fixture.awayId)}${kickoff}`);
    if (isPlayed(fixture) && fixture.scorers?.length) lines.push(`  Scorers: ${fixture.scorers.map((row) => `${row.name} ×${row.goals} (${names.get(row.teamId)})`).join(', ')}`);
  }
  const scorers = getTopScorers(tournament);
  const coverage = getScorerCoverage(tournament);
  lines.push('', 'TOP SCORERS');
  for (const scorer of scorers) lines.push(`${scorer.rank}. ${scorer.name} (${scorer.teamName}) · ${scorer.goals} goals`);
  if (!scorers.length) lines.push('No goalscorers recorded yet.');
  if (coverage.unassignedGoals) lines.push(`${coverage.unassignedGoals} goals still unassigned; recorded goals only.`);
  if (status.complete) lines.push('', `${status.winners.length > 1 ? 'Joint winners' : 'Winner'}: ${status.winners.map((winner) => winner.name).join(', ')}`);
  else lines.push('', 'Tournament in progress. Final winner determined after all scores are recorded.');
  lines.push('Ranking: points, goal difference, goals scored. Exact ties share a place.', 'SIDELINE · Better teams. Better games.');
  return lines.join('\n');
}
