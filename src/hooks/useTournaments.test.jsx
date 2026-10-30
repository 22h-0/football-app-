// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TOURNAMENTS, TOURNAMENT_STORAGE_KEY, useTournaments } from './useTournaments.js';

const options = (overrides = {}) => ({
  name: 'Weekend Cup',
  teams: [
    { id: 'a', name: 'Blue', players: [{ id: 'p1', name: 'Alex', skill: 70 }] },
    { id: 'b', name: 'Coral', players: [{ id: 'p2', name: 'Sam', skill: 72 }] },
    { id: 'c', name: 'Violet', players: [{ id: 'p3', name: 'Lee', skill: 71 }] },
  ],
  startAt: '2026-10-27T19:00',
  matchMinutes: 20,
  breakMinutes: 5,
  ...overrides,
});

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('persistent tournaments', () => {
  it('starts empty without changing existing storage or seeding example tournaments', () => {
    const { result } = renderHook(() => useTournaments(), { wrapper: StrictMode });
    expect(result.current.tournaments).toEqual([]);
    expect(result.current.activeTournament).toBeNull();
    expect(localStorage.getItem(TOURNAMENT_STORAGE_KEY)).toBeNull();
  });

  it('creates snapshots, stores scores including nil-nil, and restores across mounts', () => {
    const hook = renderHook(() => useTournaments());
    const input = options();
    act(() => { expect(hook.result.current.create(input)).toBeNull(); });
    const tournament = hook.result.current.activeTournament;
    input.teams[0].players[0].name = 'Changed elsewhere';
    expect(tournament.teams[0].players[0].name).toBe('Alex');
    act(() => {
      expect(hook.result.current.updateScore(tournament.id, tournament.fixtures[0].id, 0, 0)).toBeNull();
      expect(hook.result.current.updateKickoff(tournament.id, tournament.fixtures[0].id, '2026-10-28T20:30')).toBeNull();
    });
    hook.unmount();
    const restored = renderHook(() => useTournaments());
    expect(restored.result.current.activeId).toBe(tournament.id);
    expect(restored.result.current.activeTournament.fixtures[0]).toMatchObject({ homeScore: 0, awayScore: 0, kickoff: '2026-10-28T20:30' });
    expect(restored.result.current.storageError).toBeNull();
  });

  it('retains all batched score updates and supports correcting or clearing results', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => result.current.create(options()));
    const { id, fixtures } = result.current.activeTournament;
    act(() => {
      result.current.updateScore(id, fixtures[0].id, 1, 2);
      result.current.updateScore(id, fixtures[1].id, 4, 1);
      result.current.updateScore(id, fixtures[2].id, 0, 0);
      result.current.updateScore(id, fixtures[0].id, 3, 0);
      result.current.updateScore(id, fixtures[1].id, null, null);
      result.current.updateKickoff(id, fixtures[2].id, '');
    });
    expect(result.current.activeTournament.fixtures.map(({ homeScore, awayScore }) => [homeScore, awayScore])).toEqual([[3, 0], [null, null], [0, 0]]);
    expect(result.current.activeTournament.fixtures[2].kickoff).toBeNull();
  });

  it('selects and removes tournament history without losing unrelated results', () => {
    const hook = renderHook(() => useTournaments());
    act(() => hook.result.current.create(options({ name: 'First Cup' })));
    const first = hook.result.current.activeId;
    act(() => hook.result.current.create(options({ name: 'Second Cup', doubleRoundRobin: true })));
    const second = hook.result.current.activeId;
    act(() => { expect(hook.result.current.select(first)).toBeNull(); });
    hook.unmount();
    const restored = renderHook(() => useTournaments());
    expect(restored.result.current.activeId).toBe(first);
    act(() => restored.result.current.remove(second));
    expect(restored.result.current.activeId).toBe(first);
    act(() => restored.result.current.remove(first));
    expect(restored.result.current.activeTournament).toBeNull();
    expect(restored.result.current.tournaments).toEqual([]);
  });

  it('switches active tournament to the next saved tournament after deletion', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => { result.current.create(options()); result.current.create(options()); });
    const next = result.current.tournaments[1].id;
    act(() => result.current.remove(result.current.activeId));
    expect(result.current.activeId).toBe(next);
  });

  it('rejects invalid scores, partial results, invalid dates and stale match references', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => result.current.create(options()));
    const { id, fixtures } = result.current.activeTournament;
    const before = result.current.activeTournament;
    act(() => {
      for (const scores of [[null, 1], [1, null], ['', ''], ['1', 2], [-1, 0], [0, 100], [1.5, 0], [NaN, 0], [Infinity, 0]]) {
        expect(result.current.updateScore(id, fixtures[0].id, ...scores)).toMatch(/both scores/i);
      }
      for (const invalid of ['yesterday', '2026-02-30T20:00', '2026-10-27T25:00', undefined]) {
        expect(result.current.updateKickoff(id, fixtures[0].id, invalid)).toMatch(/valid kickoff/i);
      }
      expect(result.current.updateScore('missing', fixtures[0].id, 1, 0)).toMatch(/tournament/i);
      expect(result.current.updateScore(id, 'missing', 1, 0)).toMatch(/match/i);
      expect(result.current.select('missing')).toMatch(/no longer/i);
      expect(result.current.remove('missing')).toMatch(/no longer/i);
    });
    expect(result.current.activeTournament).toBe(before);
  });

  it('returns create errors and respects the 20-tournament limit in one batch', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => {
      expect(result.current.create(options({ name: '' }))).toMatch(/name/i);
      for (let index = 0; index < MAX_TOURNAMENTS; index++) expect(result.current.create(options({ name: `Cup ${index}` }))).toBeNull();
      expect(result.current.create(options())).toMatch(/20 tournaments/i);
    });
    expect(result.current.tournaments).toHaveLength(MAX_TOURNAMENTS);
  });

  it.each(['bad JSON', JSON.stringify({ version: 2, tournaments: [], activeId: null }), JSON.stringify({ version: 1, tournaments: [{ id: 'broken' }], activeId: 'broken' })])('preserves malformed storage until an intentional mutation', (saved) => {
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, saved);
    const { result } = renderHook(() => useTournaments());
    expect(result.current.storageError).toMatch(/could not be loaded/i);
    expect(result.current.tournaments).toEqual([]);
    expect(localStorage.getItem(TOURNAMENT_STORAGE_KEY)).toBe(saved);
    act(() => result.current.create(options()));
    expect(result.current.storageError).toBeNull();
    expect(JSON.parse(localStorage.getItem(TOURNAMENT_STORAGE_KEY)).tournaments).toHaveLength(1);
  });

  it('rejects corrupted saved result and fixture references', () => {
    const hook = renderHook(() => useTournaments());
    act(() => hook.result.current.create(options()));
    const saved = JSON.parse(localStorage.getItem(TOURNAMENT_STORAGE_KEY));
    hook.unmount();
    saved.tournaments[0].fixtures[0].awayId = 'unknown-team';
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(saved));
    const restored = renderHook(() => useTournaments());
    expect(restored.result.current.tournaments).toEqual([]);
    expect(restored.result.current.storageError).toMatch(/could not be loaded/i);
  });

  it('warns on unavailable storage while keeping score editing usable in memory', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    const { result } = renderHook(() => useTournaments());
    act(() => result.current.create(options()));
    const { id, fixtures } = result.current.activeTournament;
    act(() => result.current.updateScore(id, fixtures[0].id, 5, 0));
    expect(result.current.activeTournament.fixtures[0].homeScore).toBe(5);
    expect(result.current.storageError).toMatch(/session/i);
  });

  it('warns if storage cannot be read and still lets a tournament start', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useTournaments());
    expect(result.current.storageError).toMatch(/could not be loaded/i);
    act(() => result.current.create(options()));
    expect(result.current.activeTournament.name).toBe('Weekend Cup');
  });
});

describe('persistent match goalscorers', () => {
  function scorer(tournament, goals = 1) {
    const team = tournament.teams.find((item) => item.id === tournament.fixtures[0].homeId);
    return { teamId: team.id, playerId: team.players[0].id, name: 'Ignored draft name', goals };
  }

  it('loads legacy v1 data without changing saved scores or stored bytes', () => {
    const hook = renderHook(() => useTournaments());
    act(() => hook.result.current.create(options()));
    const tournament = hook.result.current.activeTournament;
    act(() => hook.result.current.updateScore(tournament.id, tournament.fixtures[0].id, 3, 1));
    hook.unmount();
    const data = JSON.parse(localStorage.getItem(TOURNAMENT_STORAGE_KEY));
    data.tournaments[0].fixtures.forEach((fixture) => { delete fixture.scorers; });
    const original = JSON.stringify(data);
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, original);
    const restored = renderHook(() => useTournaments());
    expect(restored.result.current.storageError).toBeNull();
    expect(restored.result.current.activeTournament.fixtures[0]).toMatchObject({ homeScore: 3, awayScore: 1, scorers: [] });
    expect(localStorage.getItem(TOURNAMENT_STORAGE_KEY)).toBe(original);
  });

  it('persists roster attributions with canonical snapshot names across mounts', () => {
    const hook = renderHook(() => useTournaments());
    act(() => hook.result.current.create(options()));
    const tournament = hook.result.current.activeTournament;
    const entry = scorer(tournament, 2);
    act(() => {
      hook.result.current.updateScore(tournament.id, tournament.fixtures[0].id, 2, 1);
      expect(hook.result.current.updateScorers(tournament.id, tournament.fixtures[0].id, [entry])).toBeNull();
    });
    hook.unmount();
    const restored = renderHook(() => useTournaments());
    const name = tournament.teams.find((team) => team.id === entry.teamId).players[0].name;
    expect(restored.result.current.activeTournament.fixtures[0].scorers).toEqual([{ ...entry, name }]);
    expect(restored.result.current.storageError).toBeNull();
  });

  it('persists normalized custom names while permitting unassigned goals', () => {
    const hook = renderHook(() => useTournaments());
    act(() => hook.result.current.create(options({ teams: [{ id: 'a', name: 'Blue' }, { id: 'b', name: 'Coral' }] })));
    const tournament = hook.result.current.activeTournament;
    const fixture = tournament.fixtures[0];
    act(() => {
      hook.result.current.updateScore(tournament.id, fixture.id, 3, 0);
      expect(hook.result.current.updateScorers(tournament.id, fixture.id, [{ teamId: fixture.homeId, playerId: null, name: '  Alex   Morgan ', goals: 2 }])).toBeNull();
    });
    hook.unmount();
    const restored = renderHook(() => useTournaments());
    expect(restored.result.current.activeTournament.fixtures[0].scorers).toEqual([{ teamId: fixture.homeId, playerId: null, name: 'Alex Morgan', goals: 2 }]);
  });

  it('clears all attributions atomically when a result is reset', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => result.current.create(options()));
    const tournament = result.current.activeTournament;
    const fixture = tournament.fixtures[0];
    act(() => {
      result.current.updateScore(tournament.id, fixture.id, 2, 0);
      result.current.updateScorers(tournament.id, fixture.id, [scorer(tournament, 2)]);
      expect(result.current.updateScore(tournament.id, fixture.id, null, null)).toBeNull();
    });
    expect(result.current.activeTournament.fixtures[0]).toMatchObject({ homeScore: null, awayScore: null, scorers: [] });
    expect(JSON.parse(localStorage.getItem(TOURNAMENT_STORAGE_KEY)).tournaments[0].fixtures[0].scorers).toEqual([]);
  });

  it('preserves attribution on higher scores and rejects lowering until attribution is corrected', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => result.current.create(options()));
    const tournament = result.current.activeTournament;
    const fixture = tournament.fixtures[0];
    act(() => {
      result.current.updateScore(tournament.id, fixture.id, 2, 0);
      result.current.updateScorers(tournament.id, fixture.id, [scorer(tournament, 2)]);
      expect(result.current.updateScore(tournament.id, fixture.id, 2, 0)).toBeNull();
      expect(result.current.updateScore(tournament.id, fixture.id, 4, 1)).toBeNull();
      expect(result.current.updateScore(tournament.id, fixture.id, 1, 0)).toMatch(/goalscorers.*before lowering/i);
    });
    expect(result.current.activeTournament.fixtures[0]).toMatchObject({ homeScore: 4, awayScore: 1 });
    expect(result.current.activeTournament.fixtures[0].scorers[0].goals).toBe(2);
    act(() => {
      result.current.updateScorers(tournament.id, fixture.id, [scorer(tournament, 1)]);
      expect(result.current.updateScore(tournament.id, fixture.id, 1, 0)).toBeNull();
    });
    expect(result.current.activeTournament.fixtures[0].homeScore).toBe(1);
  });

  it('rejects invalid attribution and stale references without committing partial edits', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => result.current.create(options()));
    const tournament = result.current.activeTournament;
    const fixture = tournament.fixtures[0];
    act(() => result.current.updateScore(tournament.id, fixture.id, 1, 0));
    const before = result.current.activeTournament;
    act(() => {
      for (const entries of [[scorer(tournament, 2)], [{ ...scorer(tournament), playerId: 'missing' }], [{ ...scorer(tournament), teamId: 'missing' }], [scorer(tournament), scorer(tournament)]]) {
        expect(result.current.updateScorers(tournament.id, fixture.id, entries)).toBeTypeOf('string');
      }
      expect(result.current.updateScorers('missing', fixture.id, [])).toMatch(/tournament/i);
      expect(result.current.updateScorers(tournament.id, 'missing', [])).toMatch(/match/i);
    });
    expect(result.current.activeTournament).toBe(before);
  });

  it('preserves invalid saved attribution with a recovery warning', () => {
    const hook = renderHook(() => useTournaments());
    act(() => hook.result.current.create(options()));
    const tournament = hook.result.current.activeTournament;
    act(() => hook.result.current.updateScore(tournament.id, tournament.fixtures[0].id, 1, 0));
    hook.unmount();
    const saved = JSON.parse(localStorage.getItem(TOURNAMENT_STORAGE_KEY));
    saved.tournaments[0].fixtures[0].scorers = [scorer(tournament, 2)];
    const bytes = JSON.stringify(saved);
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, bytes);
    const restored = renderHook(() => useTournaments());
    expect(restored.result.current.storageError).toMatch(/could not be loaded/i);
    expect(restored.result.current.tournaments).toEqual([]);
    expect(localStorage.getItem(TOURNAMENT_STORAGE_KEY)).toBe(bytes);
  });

  it('keeps scorer editing usable in memory when browser storage is unavailable', () => {
    const { result } = renderHook(() => useTournaments());
    act(() => result.current.create(options()));
    const tournament = result.current.activeTournament;
    const fixture = tournament.fixtures[0];
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    act(() => {
      result.current.updateScore(tournament.id, fixture.id, 2, 0);
      expect(result.current.updateScorers(tournament.id, fixture.id, [scorer(tournament, 2)])).toBeNull();
    });
    expect(result.current.activeTournament.fixtures[0].scorers[0].goals).toBe(2);
    expect(result.current.storageError).toMatch(/session/i);
  });
});
