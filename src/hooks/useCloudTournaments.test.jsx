import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_ACTIVE_KEY, useCloudTournaments, useSharedTournament } from './useCloudTournaments.js';

const alice = { id: 'owner-a', username: 'alice' };
const bob = { id: 'owner-b', username: 'bob' };
const cup = (id = 'cup-a', revision = 1) => ({ id, revision, name: id, teams: [], fixtures: [{ id: 'match-a' }], settings: {} });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
async function flush() { await act(async () => {}); }
async function loaded(result) { await waitFor(() => expect(result.current.activeTournament).not.toBeNull()); }
function accountResponses(...rest) { fetch.mockResolvedValueOnce(response({ user: alice })).mockResolvedValueOnce(response({ tournaments: [cup()] })); rest.forEach((item) => fetch.mockResolvedValueOnce(item)); }

beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('cloud tournament state', () => {
  it('does not contact a server from standalone mode', () => {
    const { result } = renderHook(() => useCloudTournaments(false));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.available).toBe(false);
    expect(result.current.canEdit).toBe(false);
  });

  it('detects an anonymous server without loading private cups', async () => {
    fetch.mockResolvedValue(response({ user: null }));
    const { result } = renderHook(() => useCloudTournaments(true));
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.user).toBeNull();
    expect(result.current.tournaments).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not claim live sharing works when the API is unavailable', async () => {
    fetch.mockResolvedValue({ ok: false, status: 404, json: async () => { throw new Error('HTML'); } });
    const { result } = renderHook(() => useCloudTournaments(true));
    await waitFor(() => expect(result.current.available).toBe(false));
    expect(result.current.error).toMatch(/unavailable.*not connected/i);
    expect(result.current.canEdit).toBe(false);
  });

  it('clears the previous account while signing in and never stores credentials or cloud payloads', async () => {
    const login = deferred();
    accountResponses();
    fetch.mockImplementationOnce(() => login.promise).mockResolvedValueOnce(response({ tournaments: [cup('cup-b')] }));
    const { result } = renderHook(() => useCloudTournaments(true));
    await loaded(result);
    let pending;
    act(() => { pending = result.current.login('bob', 'private-password'); });
    expect(result.current.user).toBeNull();
    expect(result.current.tournaments).toEqual([]);
    await act(async () => { login.resolve(response({ user: bob })); await pending; });
    expect(result.current.user).toEqual(bob);
    expect(result.current.activeId).toBe('cup-b');
    const [url, request] = fetch.mock.calls[2];
    expect(url).toBe('/api/login');
    expect(request.credentials).toBe('same-origin');
    expect(request.headers['X-Sideline-Client']).toBe('web');
    expect(JSON.parse(request.body)).toEqual({ username: 'bob', password: 'private-password' });
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(CLOUD_ACTIVE_KEY)).toBe('cup-b');
  });

  it('uses the latest server revision for fixture updates and activates newly created cups', async () => {
    accountResponses(response({ tournament: cup('cup-a', 2) }), response({ tournament: cup('cup-a', 3) }), response({ tournament: cup('new-cup') }));
    const { result } = renderHook(() => useCloudTournaments(true));
    await loaded(result);
    await act(async () => { expect(await result.current.updateScore('cup-a', 'match-a', 2, 0)).toBeNull(); });
    await act(async () => { expect(await result.current.updateScorers('cup-a', 'match-a', [{ name: 'Alex', goals: 2 }])).toBeNull(); });
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ expectedRevision: 1, kind: 'score', homeScore: 2, awayScore: 0 });
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toMatchObject({ expectedRevision: 2, kind: 'scorers' });
    await act(async () => { expect(await result.current.create({ name: 'New cup' })).toBeNull(); });
    expect(result.current.activeId).toBe('new-cup');
    expect(result.current.tournaments).toHaveLength(2);
  });

  it('refreshes revision conflicts without replaying the attempted mutation', async () => {
    accountResponses(response({ error: 'Stale revision' }, 409), response({ tournaments: [cup('cup-a', 4)] }));
    const { result } = renderHook(() => useCloudTournaments(true));
    await loaded(result);
    let error;
    await act(async () => { error = await result.current.updateKickoff('cup-a', 'match-a', '2026-10-30T19:00'); });
    expect(error).toMatch(/another session.*review/i);
    expect(result.current.activeTournament.revision).toBe(4);
    expect(fetch.mock.calls.filter(([, request]) => request.method === 'PATCH')).toHaveLength(1);
  });

  it('clears private state when the server rejects an expired session', async () => {
    accountResponses(response({ error: 'Not signed in' }, 401));
    const { result } = renderHook(() => useCloudTournaments(true));
    await loaded(result);
    await act(async () => { await result.current.updateScore('cup-a', 'match-a', 1, 0); });
    expect(result.current.user).toBeNull();
    expect(result.current.tournaments).toEqual([]);
    expect(result.current.canEdit).toBe(false);
    expect(result.current.error).toMatch(/expired/i);
  });

  it('ignores a delayed old-account response after logout', async () => {
    const list = deferred();
    fetch.mockResolvedValueOnce(response({ user: alice })).mockImplementationOnce(() => list.promise).mockResolvedValueOnce(response({ ok: true }));
    const { result } = renderHook(() => useCloudTournaments(true));
    await waitFor(() => expect(result.current.user).toEqual(alice));
    await act(async () => { await result.current.logout(); });
    await act(async () => { list.resolve(response({ tournaments: [cup()] })); });
    expect(result.current.user).toBeNull();
    expect(result.current.tournaments).toEqual([]);
    expect(result.current.activeId).toBeNull();
  });

  it('creates viewer links, imports a snapshot and deletes with a revision', async () => {
    accountResponses(response({ sharePath: '/watch/public-token' }), response({ tournament: cup('imported') }), response({ ok: true }));
    const { result } = renderHook(() => useCloudTournaments(true));
    await loaded(result);
    await act(async () => { expect(await result.current.createViewerLink('cup-a')).toEqual({ sharePath: '/watch/public-token' }); });
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ expectedRevision: 1 });
    await act(async () => { expect(await result.current.importTournament({ name: 'Local cup' })).toBeNull(); });
    expect(fetch.mock.calls[3][0]).toBe('/api/tournaments/import');
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({ tournament: { name: 'Local cup' } });
    await act(async () => { expect(await result.current.remove('imported')).toBeNull(); });
    expect(fetch.mock.calls[4][1].method).toBe('DELETE');
    expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({ expectedRevision: 1 });
    expect(result.current.activeId).toBe('cup-a');
  });

  it('does not overwrite a saved edit with an older in-flight list response', async () => {
    const oldList = deferred();
    accountResponses();
    fetch.mockImplementationOnce(() => oldList.promise).mockResolvedValueOnce(response({ tournament: cup('cup-a', 2) }));
    const { result } = renderHook(() => useCloudTournaments(true));
    await loaded(result);
    let pending;
    act(() => { pending = result.current.refresh(); });
    await act(async () => { await result.current.updateScore('cup-a', 'match-a', 2, 0); });
    await act(async () => { oldList.resolve(response({ tournaments: [cup()] })); await pending; });
    expect(result.current.activeTournament.revision).toBe(2);
  });

  it('keeps server mode and verified identity when loading cups fails', async () => {
    fetch.mockResolvedValueOnce(response({ user: alice })).mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useCloudTournaments(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.available).toBe(true);
    expect(result.current.user).toEqual(alice);
    expect(result.current.error).toMatch(/server is unavailable/i);
    expect(result.current.tournaments).toEqual([]);
  });
});

describe('read-only shared tournament state', () => {
  it('polls while visible and refreshes on focus without sending writes', async () => {
    vi.useFakeTimers();
    const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fetch.mockResolvedValue(response({ tournament: cup(), readOnly: true }));
    const { result } = renderHook(() => useSharedTournament('token'));
    await flush();
    expect(result.current.tournament.id).toBe('cup-a');
    expect(result.current.lastUpdated).toBeTypeOf('string');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    visible.mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    visible.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.every(([, request]) => request.method === 'GET')).toBe(true);
  });

  it('aborts requests and removes the polling timer on unmount', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    fetch.mockImplementation(() => pending.promise);
    const hook = renderHook(() => useSharedTournament('token'));
    const signal = fetch.mock.calls[0][1].signal;
    hook.unmount();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    pending.resolve(response({ tournament: cup() }));
  });

  it('never exposes a stale prior-token snapshot', async () => {
    const old = deferred();
    fetch.mockImplementationOnce(() => old.promise).mockResolvedValueOnce(response({ tournament: cup('new-public-cup') }));
    const { result, rerender } = renderHook(({ token }) => useSharedTournament(token), { initialProps: { token: 'old' } });
    rerender({ token: 'new' });
    await waitFor(() => expect(result.current.tournament?.id).toBe('new-public-cup'));
    await act(async () => { old.resolve(response({ tournament: cup('old-private-cup') })); });
    expect(result.current.tournament.id).toBe('new-public-cup');
  });

  it('clears revoked links instead of continuing to display their snapshot', async () => {
    fetch.mockResolvedValueOnce(response({ tournament: cup() })).mockResolvedValueOnce(response({ error: 'Not found' }, 404));
    const { result } = renderHook(() => useSharedTournament('token'));
    await waitFor(() => expect(result.current.tournament).not.toBeNull());
    await act(async () => { await result.current.refresh(); });
    expect(result.current.tournament).toBeNull();
    expect(result.current.error).toMatch(/expired.*replaced/i);
  });
});
