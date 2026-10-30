// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PLAYERS, ROSTER_STORAGE_KEY, useRoster } from './useRoster';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('persistent player roster', () => {
  it('seeds new users once and saves the roster even under Strict Mode', () => {
    const { result } = renderHook(() => useRoster(), { wrapper: StrictMode });
    expect(result.current.players).toHaveLength(16);
    expect(result.current.selectedIds).toHaveLength(12);
    const saved = JSON.parse(localStorage.getItem(ROSTER_STORAGE_KEY));
    expect(saved.version).toBe(1);
    expect(saved.players).toEqual(result.current.players);
  });

  it('persists additions, edits, deletion, and availability across mounts', () => {
    const hook = renderHook(() => useRoster());
    act(() => {
      expect(hook.result.current.addPlayer('  New player  ', 98)).toBeNull();
    });
    const added = hook.result.current.players.at(-1);
    expect(added.name).toBe('New player');
    expect(hook.result.current.selectedIds).toContain(added.id);
    act(() => {
      expect(hook.result.current.updatePlayer(added.id, 'Updated player', 87)).toBeNull();
      hook.result.current.togglePlayer(added.id);
      hook.result.current.deletePlayer('demo-1');
    });
    hook.unmount();
    const restored = renderHook(() => useRoster());
    expect(restored.result.current.players.find(({ id }) => id === added.id)).toEqual({
      id: added.id, name: 'Updated player', skill: 87,
    });
    expect(restored.result.current.players.some(({ id }) => id === 'demo-1')).toBe(false);
    expect(restored.result.current.selectedIds).not.toContain(added.id);
    expect(restored.result.current.selectedIds).not.toContain('demo-1');
  });

  it('preserves an intentionally empty roster instead of reseeding examples', () => {
    localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify({ version: 1, players: [], selectedIds: [] }));
    const { result } = renderHook(() => useRoster());
    expect(result.current.players).toEqual([]);
    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.storageError).toBeNull();
  });

  it('handles several actions in one batch without losing additions or selections', () => {
    const { result } = renderHook(() => useRoster());
    act(() => {
      result.current.addPlayer('First', 40);
      result.current.addPlayer('Second', 50);
      result.current.clearSelection();
      result.current.selectAll();
    });
    expect(result.current.players).toHaveLength(18);
    expect(result.current.selectedIds).toHaveLength(18);
  });

  it('rejects invalid player data and caps the roster during batched actions', () => {
    const { result } = renderHook(() => useRoster());
    const original = result.current.players;
    act(() => {
      expect(result.current.addPlayer('   ', 55)).toMatch(/name/i);
      expect(result.current.addPlayer('x'.repeat(41), 55)).toMatch(/name/i);
      for (const invalid of [0, 101, NaN, Infinity, 2.5, '45']) {
        expect(result.current.addPlayer('Player', invalid)).toMatch(/skill/i);
      }
      expect(result.current.updatePlayer('unknown', 'Player', 40)).toMatch(/no longer/i);
      expect(result.current.deletePlayer('unknown')).toMatch(/no longer/i);
      expect(result.current.togglePlayer('unknown')).toMatch(/no longer/i);
    });
    expect(result.current.players).toBe(original);
    act(() => {
      for (let i = 16; i < MAX_PLAYERS; i++) expect(result.current.addPlayer(`Player ${i}`, 50)).toBeNull();
      expect(result.current.addPlayer('One too many', 50)).toMatch(/100/);
    });
    expect(result.current.players).toHaveLength(MAX_PLAYERS);
  });

  it('deduplicates availability and discards references to missing players on load', () => {
    localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify({
      version: 1,
      players: [{ id: 'one', name: 'One', skill: 60 }],
      selectedIds: ['one', 'one', 'missing', null],
    }));
    const { result } = renderHook(() => useRoster());
    expect(result.current.selectedIds).toEqual(['one']);
  });

  it.each([
    'not valid JSON',
    JSON.stringify({ version: 2, players: [], selectedIds: [] }),
    JSON.stringify({ version: 1, players: [{ id: 'one', name: 'One', skill: -5 }], selectedIds: [] }),
    JSON.stringify({ version: 1, players: [
      { id: 'one', name: 'One', skill: 50 }, { id: 'one', name: 'Two', skill: 50 },
    ], selectedIds: [] }),
  ])('warns about malformed data and preserves it until an intentional change', (saved) => {
    localStorage.setItem(ROSTER_STORAGE_KEY, saved);
    const { result } = renderHook(() => useRoster());
    expect(result.current.storageError).toMatch(/could not be loaded/i);
    expect(result.current.players).toEqual([]);
    expect(localStorage.getItem(ROSTER_STORAGE_KEY)).toBe(saved);
    act(() => result.current.addPlayer('New start', 70));
    expect(result.current.players).toHaveLength(1);
    expect(result.current.storageError).toBeNull();
    expect(JSON.parse(localStorage.getItem(ROSTER_STORAGE_KEY)).players[0].name).toBe('New start');
  });

  it('keeps changes usable in memory and warns when browser storage cannot save', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded'); });
    const { result } = renderHook(() => useRoster());
    expect(result.current.storageError).toMatch(/session/i);
    act(() => result.current.addPlayer('Still usable', 70));
    expect(result.current.players.at(-1).name).toBe('Still usable');
    expect(result.current.storageError).toMatch(/may be lost/i);
  });

  it('stays usable when browser storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useRoster());
    expect(result.current.players).toEqual([]);
    expect(result.current.storageError).toMatch(/could not be loaded/i);
    act(() => result.current.addPlayer('Available locally', 60));
    expect(result.current.players).toHaveLength(1);
  });
});
