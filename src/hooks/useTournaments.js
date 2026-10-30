import { useEffect, useRef, useState } from 'react';
import { createTournament, isValidKickoff } from '../lib/tournament.js';
import { normalizeScorers } from '../lib/goalscorers.js';

export const TOURNAMENT_STORAGE_KEY = 'sideline.tournaments.v1';
export const MAX_TOURNAMENTS = 20;

const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 100;
const validName = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const validScore = (value) => Number.isInteger(value) && value >= 0 && value <= 99;
const validScorePair = (home, away) => (home === null && away === null) || (validScore(home) && validScore(away));
const validKickoff = (value) => value === null || isValidKickoff(value);
const wholeInRange = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

function validTournament(tournament) {
  if (!tournament || !validId(tournament.id) || !validName(tournament.name, 60)
    || typeof tournament.createdAt !== 'string' || !Number.isFinite(Date.parse(tournament.createdAt))
    || !Array.isArray(tournament.teams) || tournament.teams.length < 2 || tournament.teams.length > 6
    || !Array.isArray(tournament.fixtures) || !tournament.settings) return false;

  const { teams, fixtures, settings } = tournament;
  if (typeof settings.doubleRoundRobin !== 'boolean' || !validKickoff(settings.startAt)
    || !wholeInRange(settings.matchMinutes, 1, 180) || !wholeInRange(settings.breakMinutes, 0, 120)) return false;
  if (teams.some((team) => !team || !validId(team.id) || !validName(team.name, 30)
    || (team.players !== undefined && (!Array.isArray(team.players) || team.players.length > 100
      || team.players.some((player) => !player || !validId(player.id) || !validName(player.name, 40)
        || !wholeInRange(player.skill, 1, 100)))))) return false;
  const teamIds = new Set(teams.map((team) => team.id));
  if (teamIds.size !== teams.length || new Set(teams.map((team) => team.name.trim().toLocaleLowerCase())).size !== teams.length) return false;
  const requiredCount = teams.length * (teams.length - 1) / (settings.doubleRoundRobin ? 1 : 2);
  if (fixtures.length !== requiredCount) return false;
  const ids = new Set();
  const pairCounts = new Map();
  const roundPlayers = new Map();
  const maxRounds = (teams.length % 2 ? teams.length : teams.length - 1) * (settings.doubleRoundRobin ? 2 : 1);
  for (const fixture of fixtures) {
    if (!fixture || !validId(fixture.id) || ids.has(fixture.id)
      || !teamIds.has(fixture.homeId) || !teamIds.has(fixture.awayId) || fixture.homeId === fixture.awayId
      || !wholeInRange(fixture.round, 1, maxRounds) || !validKickoff(fixture.kickoff)
      || !validScorePair(fixture.homeScore, fixture.awayScore)) return false;
    try { normalizeScorers(tournament, fixture, fixture.scorers); } catch { return false; }
    ids.add(fixture.id);
    const pair = JSON.stringify([fixture.homeId, fixture.awayId].sort());
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    const occupied = roundPlayers.get(fixture.round) ?? new Set();
    if (occupied.has(fixture.homeId) || occupied.has(fixture.awayId)) return false;
    occupied.add(fixture.homeId); occupied.add(fixture.awayId);
    roundPlayers.set(fixture.round, occupied);
  }
  return pairCounts.size === teams.length * (teams.length - 1) / 2
    && [...pairCounts.values()].every((count) => count === (settings.doubleRoundRobin ? 2 : 1));
}

function readTournaments() {
  try {
    const raw = window.localStorage.getItem(TOURNAMENT_STORAGE_KEY);
    if (raw === null) return { data: { tournaments: [], activeId: null }, error: null };
    const saved = JSON.parse(raw);
    if (!saved || saved.version !== 1 || !Array.isArray(saved.tournaments)
      || saved.tournaments.length > MAX_TOURNAMENTS || !saved.tournaments.every(validTournament)
      || new Set(saved.tournaments.map((tournament) => tournament.id)).size !== saved.tournaments.length
      || (saved.activeId !== null && typeof saved.activeId !== 'string')) throw new Error('Invalid saved tournaments');
    // Legacy v1 fixtures have no scorer list. Normalize in memory without
    // rewriting the user's saved data until an intentional mutation.
    const tournaments = saved.tournaments.map((tournament) => ({
      ...tournament,
      fixtures: tournament.fixtures.map((fixture) => ({ ...fixture, scorers: normalizeScorers(tournament, fixture, fixture.scorers) })),
    }));
    const activeId = tournaments.some((tournament) => tournament.id === saved.activeId)
      ? saved.activeId : saved.tournaments[0]?.id ?? null;
    return { data: { tournaments, activeId }, error: null };
  } catch {
    return {
      data: { tournaments: [], activeId: null },
      error: 'Saved tournaments could not be loaded. Browser data is preserved until you make a change; you can still create a tournament.',
    };
  }
}

/** Persistent tournament history. Mutations return null or a user-facing error. */
export function useTournaments() {
  const [initial] = useState(readTournaments);
  const [snapshot, setSnapshot] = useState({ data: initial.data, revision: 0 });
  const latest = useRef(snapshot.data);
  const [storageError, setStorageError] = useState(initial.error);

  useEffect(() => {
    if (snapshot.revision === 0) return;
    try {
      window.localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify({ version: 1, ...snapshot.data }));
      setStorageError(null);
    } catch {
      setStorageError('Tournament changes are kept for this session, but browser storage is unavailable. Your latest scores may be lost when you close the app.');
    }
  }, [snapshot]);

  function commit(data) {
    latest.current = data;
    setSnapshot((previous) => ({ data, revision: previous.revision + 1 }));
    return null;
  }

  function create(options) {
    const data = latest.current;
    if (data.tournaments.length >= MAX_TOURNAMENTS) return 'You can save up to 20 tournaments. Remove an old tournament before creating another.';
    try {
      const tournament = createTournament(options);
      tournament.fixtures = tournament.fixtures.map((fixture) => ({ ...fixture, scorers: [] }));
      return commit({ tournaments: [tournament, ...data.tournaments], activeId: tournament.id });
    } catch (error) { return error.message || 'This tournament could not be created. Please check your settings.'; }
  }

  function select(id) {
    const data = latest.current;
    if (!data.tournaments.some((tournament) => tournament.id === id)) return 'This tournament is no longer available.';
    if (id === data.activeId) return null;
    return commit({ ...data, activeId: id });
  }

  function updateFixture(tournamentId, fixtureId, patch) {
    const data = latest.current;
    const tournament = data.tournaments.find((item) => item.id === tournamentId);
    if (!tournament) return 'This tournament is no longer available.';
    if (!tournament.fixtures.some((fixture) => fixture.id === fixtureId)) return 'This match is no longer available.';
    return commit({
      ...data,
      tournaments: data.tournaments.map((item) => item.id !== tournamentId ? item : {
        ...item,
        fixtures: item.fixtures.map((fixture) => fixture.id === fixtureId ? { ...fixture, ...patch } : fixture),
      }),
    });
  }

  function updateScore(tournamentId, fixtureId, homeScore, awayScore) {
    if (!validScorePair(homeScore, awayScore)) return 'Enter both scores as whole numbers from 0 to 99, or clear both to mark the match unplayed.';
    const tournament = latest.current.tournaments.find((item) => item.id === tournamentId);
    if (!tournament) return 'This tournament is no longer available.';
    const fixture = tournament.fixtures.find((item) => item.id === fixtureId);
    if (!fixture) return 'This match is no longer available.';
    if (homeScore === null) return updateFixture(tournamentId, fixtureId, { homeScore, awayScore, scorers: [] });
    let scorers;
    try { scorers = normalizeScorers(tournament, { ...fixture, homeScore, awayScore }, fixture.scorers); }
    catch { return 'Adjust or remove the goalscorers before lowering the match score below their recorded goals.'; }
    return updateFixture(tournamentId, fixtureId, { homeScore, awayScore, scorers });
  }

  function updateScorers(tournamentId, fixtureId, entries) {
    const tournament = latest.current.tournaments.find((item) => item.id === tournamentId);
    if (!tournament) return 'This tournament is no longer available.';
    const fixture = tournament.fixtures.find((item) => item.id === fixtureId);
    if (!fixture) return 'This match is no longer available.';
    try { return updateFixture(tournamentId, fixtureId, { scorers: normalizeScorers(tournament, fixture, entries) }); }
    catch (error) { return error.message || 'These goalscorers could not be saved. Please check the entries.'; }
  }

  function updateKickoff(tournamentId, fixtureId, kickoff) {
    const value = kickoff === '' ? null : kickoff;
    if (!validKickoff(value)) return 'Enter a valid kickoff date and time, or leave it blank.';
    return updateFixture(tournamentId, fixtureId, { kickoff: value });
  }

  function remove(id) {
    const data = latest.current;
    if (!data.tournaments.some((tournament) => tournament.id === id)) return 'This tournament is no longer available.';
    const tournaments = data.tournaments.filter((tournament) => tournament.id !== id);
    return commit({ tournaments, activeId: data.activeId === id ? tournaments[0]?.id ?? null : data.activeId });
  }

  return {
    ...snapshot.data,
    activeTournament: snapshot.data.tournaments.find((tournament) => tournament.id === snapshot.data.activeId) ?? null,
    storageError,
    create, select, updateScore, updateScorers, updateKickoff, remove,
  };
}
