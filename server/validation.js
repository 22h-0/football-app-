import { randomUUID } from 'node:crypto';
import { createTournament, isValidKickoff, isValidScore } from '../src/lib/tournament.js';
import { normalizeScorers } from '../src/lib/goalscorers.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(value);
export const validScorePair = (home, away) => (home === null && away === null) || (isValidScore(home) && isValidScore(away));

export function requireObject(value, message = 'Send a JSON object.') {
  if (!object(value)) throw new RangeError(message);
  return value;
}

function normalizeTeams(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 6) throw new RangeError('Choose between 2 and 6 teams.');
  const playersSeen = new Set();
  let playerCount = 0;
  return value.map((team) => {
    if (!object(team) || !id(team.id) || !text(team.name, 30)) throw new RangeError('Every team needs an ID and a name between 1 and 30 characters.');
    if (team.players !== undefined && !Array.isArray(team.players)) throw new RangeError('A team roster must be a list of players.');
    const players = (team.players ?? []).map((player) => {
      if (!object(player) || !id(player.id) || !text(player.name, 40) || !Number.isInteger(player.skill) || player.skill < 1 || player.skill > 100) throw new RangeError('Each player needs a valid ID, name, and whole-number skill from 1 to 100.');
      if (playersSeen.has(player.id)) throw new RangeError('A player can belong to only one tournament team.');
      playersSeen.add(player.id);
      playerCount += 1;
      if (playerCount > 100) throw new RangeError('A tournament can contain up to 100 players.');
      return { id: player.id, name: player.name.trim(), skill: player.skill };
    });
    return { id: team.id, name: team.name.trim(), players };
  });
}

/** Whitelist all fields; owner IDs and revisions never come from request data. */
export function newTournament(options) {
  requireObject(options);
  const teams = normalizeTeams(options.teams);
  const tournament = createTournament({ name: options.name, teams, doubleRoundRobin: options.doubleRoundRobin, startAt: options.startAt, matchMinutes: options.matchMinutes, breakMinutes: options.breakMinutes });
  return { ...tournament, fixtures: tournament.fixtures.map((fixture) => ({ ...fixture, scorers: [] })) };
}

/** Validate a full offline snapshot, retaining scores but assigning new IDs. */
export function importTournament(snapshot) {
  requireObject(snapshot, 'Choose a valid tournament snapshot to import.');
  requireObject(snapshot.settings, 'The tournament format is missing.');
  if (typeof snapshot.settings.doubleRoundRobin !== 'boolean' || !(snapshot.settings.startAt === null || isValidKickoff(snapshot.settings.startAt))
    || !Number.isInteger(snapshot.settings.matchMinutes) || !Number.isInteger(snapshot.settings.breakMinutes)
    || typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt))) throw new RangeError('The tournament settings or creation date are invalid.');
  const tournament = newTournament({
    name: snapshot.name, teams: snapshot.teams,
    doubleRoundRobin: snapshot.settings.doubleRoundRobin,
    startAt: snapshot.settings.startAt,
    matchMinutes: snapshot.settings.matchMinutes,
    breakMinutes: snapshot.settings.breakMinutes,
  });
  if (!Array.isArray(snapshot.fixtures) || snapshot.fixtures.length !== tournament.fixtures.length) throw new RangeError('The tournament must contain its complete round-robin schedule.');
  const teamIds = new Set(tournament.teams.map((team) => team.id));
  const fixtureIds = new Set();
  const pairCounts = new Map();
  const directions = new Set();
  const rounds = new Map();
  const maxRounds = (tournament.teams.length % 2 ? tournament.teams.length : tournament.teams.length - 1) * (tournament.settings.doubleRoundRobin ? 2 : 1);
  const fixtures = snapshot.fixtures.map((fixture) => {
    if (!object(fixture) || !id(fixture.id) || fixtureIds.has(fixture.id) || !teamIds.has(fixture.homeId) || !teamIds.has(fixture.awayId) || fixture.homeId === fixture.awayId
      || !Number.isInteger(fixture.round) || fixture.round < 1 || fixture.round > maxRounds
      || !(fixture.kickoff === null || isValidKickoff(fixture.kickoff)) || !validScorePair(fixture.homeScore, fixture.awayScore)) throw new RangeError('A saved fixture has invalid teams, scores, or scheduling.');
    fixtureIds.add(fixture.id);
    const occupied = rounds.get(fixture.round) ?? new Set();
    if (occupied.has(fixture.homeId) || occupied.has(fixture.awayId)) throw new RangeError('A team cannot play twice in the same round.');
    occupied.add(fixture.homeId); occupied.add(fixture.awayId); rounds.set(fixture.round, occupied);
    const pair = JSON.stringify([fixture.homeId, fixture.awayId].sort());
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    const direction = JSON.stringify([fixture.homeId, fixture.awayId]);
    if (tournament.settings.doubleRoundRobin && directions.has(direction)) throw new RangeError('Home-and-away fixtures must reverse the two teams.');
    directions.add(direction);
    const canonical = { id: `fixture-${randomUUID()}`, round: fixture.round, homeId: fixture.homeId, awayId: fixture.awayId, kickoff: fixture.kickoff, homeScore: fixture.homeScore, awayScore: fixture.awayScore };
    return { ...canonical, scorers: normalizeScorers(tournament, canonical, fixture.scorers) };
  });
  if (pairCounts.size !== tournament.teams.length * (tournament.teams.length - 1) / 2 || [...pairCounts.values()].some((count) => count !== (tournament.settings.doubleRoundRobin ? 2 : 1))) throw new RangeError('Every team pairing must be included in the tournament.');
  return { ...tournament, createdAt: new Date(snapshot.createdAt).toISOString(), fixtures: fixtures.sort((a, b) => a.round - b.round) };
}

export function changeFixture(tournament, fixtureId, patch) {
  requireObject(patch);
  const fixture = tournament.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) return null;
  let changed;
  switch (patch.kind) {
    case 'score': {
      if (!validScorePair(patch.homeScore, patch.awayScore)) throw new RangeError('Enter both scores as whole numbers from 0 to 99, or clear both.');
      changed = { ...fixture, homeScore: patch.homeScore, awayScore: patch.awayScore };
      if (patch.homeScore === null) changed.scorers = [];
      else {
        try { changed.scorers = normalizeScorers(tournament, changed, fixture.scorers); }
        catch { throw new RangeError('Adjust or remove the goalscorers before lowering the match score below their recorded goals.'); }
      }
      break;
    }
    case 'scorers': {
      if (!Array.isArray(patch.entries)) throw new RangeError('Send a list of goalscorer entries.');
      changed = { ...fixture, scorers: normalizeScorers(tournament, fixture, patch.entries) };
      break;
    }
    case 'kickoff': {
      const kickoff = patch.kickoff === '' ? null : patch.kickoff;
      if (!(kickoff === null || isValidKickoff(kickoff))) throw new RangeError('Enter a valid kickoff date and time, or leave it blank.');
      changed = { ...fixture, kickoff };
      break;
    }
    default: throw new RangeError('Choose a valid fixture update: score, scorers, or kickoff.');
  }
  return { ...tournament, fixtures: tournament.fixtures.map((item) => item.id === fixtureId ? changed : item) };
}
