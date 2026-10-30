/** Match goalscorer validation and tournament-wide Golden Boot statistics. */
function displayName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
}
function score(value) { return Number.isInteger(value) && value >= 0 && value <= 99; }
function playerKey(entry) {
  return JSON.stringify([entry.teamId, entry.playerId === null ? 'name' : 'player', entry.playerId ?? displayName(entry.name).toLowerCase()]);
}
function validPlayedFixture(tournament, fixture) {
  return fixture && score(fixture.homeScore) && score(fixture.awayScore) && fixture.homeId !== fixture.awayId
    && Array.isArray(tournament?.teams) && tournament.teams.some((team) => team.id === fixture.homeId)
    && tournament.teams.some((team) => team.id === fixture.awayId);
}

/** Canonical independent records; legacy missing records become an empty list. */
export function normalizeScorers(tournament, fixture, entries = []) {
  if (!Array.isArray(entries) || entries.length > 198) throw new RangeError('Add no more than 198 goalscorer entries per match.');
  if (!entries.length) return [];
  if (!validPlayedFixture(tournament, fixture)) throw new RangeError('Save both match scores before adding goalscorers.');
  const totals = new Map([[fixture.homeId, 0], [fixture.awayId, 0]]);
  const seen = new Set();
  const normalized = entries.map((entry) => {
    if (!entry || !totals.has(entry.teamId)) throw new RangeError('Each goalscorer must belong to one of the teams in this match.');
    if (!Number.isInteger(entry.goals) || entry.goals < 1 || entry.goals > 99) throw new RangeError('Goals must be whole numbers between 1 and 99.');
    const team = tournament.teams.find((item) => item.id === entry.teamId);
    let canonical;
    if (Array.isArray(team.players) && team.players.length) {
      const player = typeof entry.playerId === 'string' ? team.players.find((item) => item.id === entry.playerId) : null;
      if (!player) throw new RangeError(`Choose a player from ${team.name}’s tournament squad.`);
      canonical = { teamId: team.id, playerId: player.id, name: player.name, goals: entry.goals };
    } else {
      const name = displayName(entry.name);
      if (entry.playerId !== null || !name || name.length > 40) throw new RangeError('Enter a goalscorer name between 1 and 40 characters for a custom team.');
      canonical = { teamId: team.id, playerId: null, name, goals: entry.goals };
    }
    const key = playerKey(canonical);
    if (seen.has(key)) throw new RangeError(`Use one entry for ${canonical.name} and set their total goals for this match.`);
    seen.add(key);
    totals.set(team.id, totals.get(team.id) + canonical.goals);
    return canonical;
  });
  for (const [teamId, goals] of totals) {
    const maximum = teamId === fixture.homeId ? fixture.homeScore : fixture.awayScore;
    if (goals > maximum) {
      const team = tournament.teams.find((item) => item.id === teamId);
      throw new RangeError(`${team.name}’s goalscorer totals cannot exceed its saved score of ${maximum}.`);
    }
  }
  return normalized;
}

function attributedFixtures(tournament) {
  return (Array.isArray(tournament?.fixtures) ? tournament.fixtures : [])
    .filter((fixture) => validPlayedFixture(tournament, fixture)).map((fixture) => {
      try { return { fixture, scorers: normalizeScorers(tournament, fixture, fixture.scorers) }; }
      catch { return { fixture, scorers: [] }; }
    });
}

/** Equal goal counts share rank; alphabetical sorting only controls display. */
export function getTopScorers(tournament) {
  const totals = new Map();
  const teams = new Map((tournament?.teams ?? []).map((team) => [team.id, team]));
  for (const { scorers } of attributedFixtures(tournament)) {
    for (const scorer of scorers) {
      const key = playerKey(scorer);
      const previous = totals.get(key);
      if (previous) previous.goals += scorer.goals;
      else totals.set(key, { key, teamId: scorer.teamId, teamName: teams.get(scorer.teamId).name, playerId: scorer.playerId, name: scorer.name, goals: scorer.goals, rank: 0 });
    }
  }
  const rows = [...totals.values()].sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name) || a.teamName.localeCompare(b.teamName) || a.key.localeCompare(b.key));
  rows.forEach((row, index) => { row.rank = index && row.goals === rows[index - 1].goals ? rows[index - 1].rank : index + 1; });
  return rows;
}

export function getScorerCoverage(tournament) {
  let totalGoals = 0;
  let recordedGoals = 0;
  for (const { fixture, scorers } of attributedFixtures(tournament)) {
    totalGoals += fixture.homeScore + fixture.awayScore;
    recordedGoals += scorers.reduce((sum, entry) => sum + entry.goals, 0);
  }
  const unassignedGoals = totalGoals - recordedGoals;
  return { totalGoals, recordedGoals, unassignedGoals, complete: unassignedGoals === 0 };
}
