import { useEffect, useRef, useState } from 'react';

export const ROSTER_STORAGE_KEY = 'sideline.roster.v1';
export const MAX_PLAYERS = 100;

const DEMO_PLAYERS = [
  ['Jamie Cole', 88], ['Marcus Reed', 82], ['Leo Martinez', 79],
  ['Omar Hassan', 76], ['Noah Williams', 74], ['Lucas Silva', 91],
  ['Daniel Park', 68], ['Sam Wilson', 71], ['Theo Brooks', 85],
  ['Ryan Patel', 64], ['Ethan Lewis', 77], ['Oliver James', 73],
  ['Adam Clarke', 80], ['Ben Taylor', 66], ['Max Turner', 83],
  ['Zain Ahmed', 70],
].map(([name, skill], index) => ({ id: `demo-${index + 1}`, name, skill }));

function freshRoster() {
  return {
    players: DEMO_PLAYERS.map((player) => ({ ...player })),
    selectedIds: DEMO_PLAYERS.slice(0, 12).map((player) => player.id),
  };
}

function validName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 40;
}

function validSkill(skill) {
  return Number.isInteger(skill) && skill >= 1 && skill <= 100;
}

function readRoster() {
  try {
    const saved = window.localStorage.getItem(ROSTER_STORAGE_KEY);
    if (saved === null) return { data: freshRoster(), persist: true, error: null };
    const parsed = JSON.parse(saved);
    if (
      !parsed || parsed.version !== 1 || !Array.isArray(parsed.players)
      || parsed.players.length > MAX_PLAYERS || !Array.isArray(parsed.selectedIds)
      || parsed.players.some((player) => (
        !player || typeof player.id !== 'string' || !player.id
        || !validName(player.name) || !validSkill(player.skill)
      ))
    ) throw new Error('invalid roster');
    const ids = new Set(parsed.players.map((player) => player.id));
    if (ids.size !== parsed.players.length) throw new Error('duplicate ids');
    const players = parsed.players.map(({ id, name, skill }) => ({ id, name: name.trim(), skill }));
    const selectedIds = [...new Set(parsed.selectedIds.filter((id) => typeof id === 'string' && ids.has(id)))];
    return { data: { players, selectedIds }, persist: false, error: null };
  } catch {
    return {
      data: { players: [], selectedIds: [] },
      persist: false,
      error: 'Saved players could not be loaded. Browser data is preserved until you make a change; you can still use the app.',
    };
  }
}

function newId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Roster and match availability, backed by browser storage.
 * Mutation methods return null on success or a user-facing validation error.
 * Storage failures never discard the in-memory roster.
 */
export function useRoster() {
  const [initial] = useState(readRoster);
  const [snapshot, setSnapshot] = useState({ data: initial.data, revision: 0 });
  const latest = useRef(snapshot.data);
  const [storageError, setStorageError] = useState(initial.error);

  useEffect(() => {
    if (snapshot.revision === 0 && !initial.persist) return;
    try {
      window.localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify({
        version: 1,
        ...snapshot.data,
      }));
      setStorageError(null);
    } catch {
      setStorageError('Changes are kept for this session, but browser storage is unavailable. Your latest changes may be lost when you close the app.');
    }
  }, [snapshot, initial.persist]);

  // The ref lets successive actions in the same React batch see each other's
  // changes. Functional updates retain the correct revision under batching.
  function commit(nextData) {
    latest.current = nextData;
    setSnapshot((previous) => ({ data: nextData, revision: previous.revision + 1 }));
    return null;
  }

  function validate(name, skill) {
    if (!validName(name)) return 'Enter a player name between 1 and 40 characters.';
    if (!validSkill(skill)) return 'Skill must be a whole number between 1 and 100.';
    return null;
  }

  function addPlayer(name, skill) {
    const error = validate(name, skill);
    if (error) return error;
    const data = latest.current;
    if (data.players.length >= MAX_PLAYERS) return 'Your roster can contain up to 100 players.';
    const player = { id: newId(), name: name.trim(), skill };
    return commit({
      players: [...data.players, player],
      selectedIds: [...data.selectedIds, player.id],
    });
  }

  function updatePlayer(id, name, skill) {
    const error = validate(name, skill);
    if (error) return error;
    const data = latest.current;
    if (!data.players.some((player) => player.id === id)) return 'This player is no longer in your roster.';
    return commit({
      ...data,
      players: data.players.map((player) => player.id === id ? { ...player, name: name.trim(), skill } : player),
    });
  }

  function deletePlayer(id) {
    const data = latest.current;
    if (!data.players.some((player) => player.id === id)) return 'This player is no longer in your roster.';
    return commit({
      players: data.players.filter((player) => player.id !== id),
      selectedIds: data.selectedIds.filter((selected) => selected !== id),
    });
  }

  function togglePlayer(id) {
    const data = latest.current;
    if (!data.players.some((player) => player.id === id)) return 'This player is no longer in your roster.';
    return commit({
      ...data,
      selectedIds: data.selectedIds.includes(id)
        ? data.selectedIds.filter((selected) => selected !== id)
        : [...data.selectedIds, id],
    });
  }

  function selectAll() {
    const data = latest.current;
    return commit({ ...data, selectedIds: data.players.map((player) => player.id) });
  }

  function clearSelection() {
    return commit({ ...latest.current, selectedIds: [] });
  }

  return {
    ...snapshot.data,
    addPlayer,
    updatePlayer,
    deletePlayer,
    togglePlayer,
    selectAll,
    clearSelection,
    storageError,
  };
}
