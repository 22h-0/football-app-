import { useCallback, useEffect, useRef, useState } from 'react';

export const CLOUD_ACTIVE_KEY = 'sideline.cloud.active.v1';
const OFFLINE = 'The shared tournament server is unavailable. Live sharing is not connected.';

class APIError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

async function requestJSON(url, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method, credentials: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json', 'X-Sideline-Client': 'web', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new APIError(OFFLINE);
  }
  let data;
  try { data = await response.json(); }
  catch { throw new APIError(response.status === 404 ? OFFLINE : 'The shared tournament server returned an unreadable response.', response.status); }
  if (!response.ok) throw new APIError((typeof data?.error === 'string' ? data.error : data?.error?.message) || `The server could not complete this request (${response.status}).`, response.status);
  return data;
}

function savedActiveId() { try { return localStorage.getItem(CLOUD_ACTIVE_KEY); } catch { return null; } }
function validUser(user) { return user === null || (typeof user?.id === 'string' && typeof user?.username === 'string'); }
function validCup(cup) { return typeof cup?.id === 'string' && typeof cup?.name === 'string' && Number.isInteger(cup.revision) && cup.revision >= 0 && Array.isArray(cup.teams) && Array.isArray(cup.fixtures); }

/** Cookie-authenticated cloud state. Only the active ID is stored locally. */
export function useCloudTournaments(enabled) {
  const [state, setState] = useState({ available: enabled ? null : false, user: null, loading: !!enabled, error: null, storageError: null, tournaments: [], activeId: null });
  const latest = useRef(state);
  const alive = useRef(true);
  const active = useRef(!!enabled);
  const epoch = useRef(0);
  const writes = useRef(0);
  const listTicket = useRef(0);
  const commit = useCallback((patch) => { if (alive.current) { latest.current = { ...latest.current, ...patch }; setState(latest.current); } }, []);
  const remember = useCallback((id) => {
    try {
      if (id === null) localStorage.removeItem(CLOUD_ACTIVE_KEY); else localStorage.setItem(CLOUD_ACTIVE_KEY, id);
      if (latest.current.storageError) commit({ storageError: null });
    } catch { commit({ storageError: 'Your active tournament selection could not be saved on this device. Tournament data remains saved on the server.' }); }
  }, [commit]);
  const clearAccount = useCallback((message = null) => { epoch.current += 1; commit({ user: null, tournaments: [], activeId: null, loading: false, error: message }); }, [commit]);

  const loadList = useCallback(async (ticket, signal) => {
    const read = ++listTicket.current;
    const version = writes.current;
    let data;
    try { data = await requestJSON('/api/tournaments', { signal }); }
    catch (error) { if (!alive.current || ticket !== epoch.current || read !== listTicket.current) return; throw error; }
    if (!alive.current || ticket !== epoch.current || read !== listTicket.current) return;
    if (version !== writes.current) { commit({ loading: false }); return; }
    if (!Array.isArray(data.tournaments) || !data.tournaments.every(validCup)) throw new APIError('The server returned an invalid tournament list.');
    const wanted = latest.current.activeId ?? savedActiveId();
    const activeId = data.tournaments.some((cup) => cup.id === wanted) ? wanted : data.tournaments[0]?.id ?? null;
    commit({ tournaments: data.tournaments, activeId, loading: false, error: null });
    remember(activeId);
  }, [commit, remember]);

  const refresh = useCallback(async () => {
    if (!active.current || !latest.current.available) return OFFLINE;
    if (!latest.current.user) return 'Sign in to view your shared tournaments.';
    const ticket = epoch.current;
    commit({ loading: true, error: null });
    try { await loadList(ticket); return ticket === epoch.current ? null : 'The account changed. Please try again.'; }
    catch (error) {
      if (!alive.current || ticket !== epoch.current) return error.message;
      if (error.status === 401) clearAccount('Your session expired. Sign in again to continue.'); else commit({ loading: false, error: error.message });
      return error.message;
    }
  }, [clearAccount, commit, loadList]);

  useEffect(() => {
    alive.current = true;
    active.current = !!enabled;
    const ticket = ++epoch.current;
    const controller = new AbortController();
    if (!enabled) {
      commit({ available: false, user: null, tournaments: [], activeId: null, loading: false, error: null });
      return () => { alive.current = false; epoch.current += 1; controller.abort(); };
    }
    commit({ available: null, user: null, tournaments: [], activeId: null, loading: true, error: null });
    (async () => {
      let sessionFound = false;
      try {
        const data = await requestJSON('/api/session', { signal: controller.signal });
        if (!data || !Object.hasOwn(data, 'user') || !validUser(data.user)) throw new APIError('The shared tournament server returned an invalid session.');
        if (!alive.current || ticket !== epoch.current) return;
        sessionFound = true;
        commit({ available: true, user: data.user, loading: !!data.user, error: null });
        if (data.user) await loadList(ticket, controller.signal);
      } catch (error) {
        if (!alive.current || ticket !== epoch.current || error.name === 'AbortError') return;
        if (error.status === 401) { commit({ available: true }); clearAccount('Your session expired. Sign in again to continue.'); }
        else if (sessionFound) commit({ available: true, loading: false, error: error.message });
        else commit({ available: error.status >= 500, loading: false, user: null, tournaments: [], activeId: null, error: error.message });
      }
    })();
    return () => { alive.current = false; epoch.current += 1; controller.abort(); };
  }, [enabled, clearAccount, commit, loadList]);

  async function authenticate(kind, username, password) {
    if (!active.current || !latest.current.available) return OFFLINE;
    const ticket = ++epoch.current;
    commit({ user: null, tournaments: [], activeId: null, loading: true, error: null });
    try {
      const data = await requestJSON(`/api/${kind}`, { method: 'POST', body: { username, password } });
      if (!data.user || !validUser(data.user)) throw new APIError('The server did not return a valid account.');
      if (!alive.current || ticket !== epoch.current) return 'The account changed. Please try again.';
      commit({ user: data.user, available: true });
      await loadList(ticket);
      return ticket === epoch.current ? null : 'The account changed. Please try again.';
    } catch (error) {
      if (alive.current && ticket === epoch.current) {
        if (error.status === 401) clearAccount(error.message); else commit({ user: null, tournaments: [], activeId: null, loading: false, error: error.message });
      }
      return error.message;
    }
  }

  async function logout() {
    if (!active.current || !latest.current.available) { clearAccount(); return null; }
    clearAccount(); remember(null);
    const ticket = epoch.current;
    try { await requestJSON('/api/logout', { method: 'POST', body: {} }); return null; }
    catch {
      const message = 'The server could not confirm sign-out. Reconnect and sign out again before sharing this browser.';
      if (alive.current && ticket === epoch.current) commit({ error: message });
      return message;
    }
  }

  function select(id) {
    if (!latest.current.tournaments.some((cup) => cup.id === id)) return 'This tournament is no longer available.';
    commit({ activeId: id }); remember(id); return null;
  }

  async function mutation(url, method, body, { removeId, activate = false } = {}) {
    if (!active.current || !latest.current.available) return { error: OFFLINE };
    if (!latest.current.user) return { error: 'Sign in to edit your shared tournaments.' };
    const ticket = epoch.current;
    try {
      const data = await requestJSON(url, { method, body });
      if (!alive.current || ticket !== epoch.current) return { error: 'The account changed. This response was discarded.' };
      if (activate && !data.tournament) throw new APIError('The server did not return the saved tournament.');
      if (removeId) {
        writes.current += 1;
        const tournaments = latest.current.tournaments.filter((cup) => cup.id !== removeId);
        const activeId = latest.current.activeId === removeId ? tournaments[0]?.id ?? null : latest.current.activeId;
        commit({ tournaments, activeId, error: null }); remember(activeId);
      } else if (data.tournament) {
        if (!validCup(data.tournament)) throw new APIError('The server returned an invalid tournament.');
        writes.current += 1;
        const previous = latest.current.tournaments.find((cup) => cup.id === data.tournament.id);
        const saved = previous && previous.revision > data.tournament.revision ? previous : data.tournament;
        const tournaments = previous ? latest.current.tournaments.map((cup) => cup.id === saved.id ? saved : cup) : [saved, ...latest.current.tournaments];
        const activeId = activate ? saved.id : latest.current.activeId;
        commit({ tournaments, activeId, error: null });
        if (activate) remember(activeId);
      } else commit({ error: null });
      return { data };
    } catch (error) {
      if (!alive.current || ticket !== epoch.current) return { error: error.message };
      if (error.status === 401) clearAccount('Your session expired. Sign in again to continue.');
      else if (error.status === 409) {
        await refresh();
        const message = 'This tournament changed in another session. The latest version has been loaded; review it and save your change again.';
        if (alive.current && ticket === epoch.current) commit({ error: message });
        return { error: message };
      } else commit({ error: error.message });
      return { error: error.message };
    }
  }

  const find = (id) => latest.current.tournaments.find((cup) => cup.id === id);
  async function fixtureMutation(tid, fid, patch) {
    const tournament = find(tid);
    if (!tournament) return 'This tournament is no longer available.';
    const result = await mutation(`/api/tournaments/${encodeURIComponent(tid)}/fixtures/${encodeURIComponent(fid)}`, 'PATCH', { expectedRevision: tournament.revision, ...patch });
    return result.error ?? null;
  }
  async function create(options) { const result = await mutation('/api/tournaments', 'POST', options, { activate: true }); return result.error ?? null; }
  async function importTournament(tournament) { const result = await mutation('/api/tournaments/import', 'POST', { tournament }, { activate: true }); return result.error ?? null; }
  async function remove(id) {
    const tournament = find(id);
    if (!tournament) return 'This tournament is no longer available.';
    const result = await mutation(`/api/tournaments/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision: tournament.revision }, { removeId: id });
    return result.error ?? null;
  }
  async function createViewerLink(id) {
    const tournament = find(id);
    if (!tournament) return { error: 'This tournament is no longer available.' };
    const result = await mutation(`/api/tournaments/${encodeURIComponent(id)}/share`, 'POST', { expectedRevision: tournament.revision });
    if (result.error) return { error: result.error };
    const path = result.data.sharePath;
    if (typeof path !== 'string' || !/^\/watch\/[A-Za-z0-9_-]+$/.test(path)) return { error: 'The server did not return a valid viewer link.' };
    return { sharePath: path };
  }
  return {
    ...state, activeTournament: state.tournaments.find((cup) => cup.id === state.activeId) ?? null, canEdit: !!state.user,
    create, select, remove, refresh, createViewerLink, importTournament, logout,
    updateScore: (tid, fid, homeScore, awayScore) => fixtureMutation(tid, fid, { kind: 'score', homeScore, awayScore }),
    updateScorers: (tid, fid, entries) => fixtureMutation(tid, fid, { kind: 'scorers', entries }),
    updateKickoff: (tid, fid, kickoff) => fixtureMutation(tid, fid, { kind: 'kickoff', kickoff }),
    register: (username, password) => authenticate('register', username, password), login: (username, password) => authenticate('login', username, password),
  };
}

/** Public read-only state; polling pauses while the page is hidden. */
export function useSharedTournament(token) {
  const [state, setState] = useState({ token: null, tournament: null, loading: !!token, error: null, lastUpdated: null });
  const current = useRef({ alive: false, token: null, ticket: 0, controller: null });
  const refresh = useCallback(async () => {
    const request = current.current;
    if (!request.alive || !request.token) return null;
    request.controller?.abort();
    const controller = new AbortController();
    request.controller = controller;
    const ticket = ++request.ticket;
    const requestedToken = request.token;
    setState((previous) => ({ ...previous, token: requestedToken, loading: true, error: null }));
    try {
      const data = await requestJSON(`/api/shared/${encodeURIComponent(requestedToken)}`, { signal: controller.signal });
      if (!validCup(data.tournament)) throw new APIError('This viewer link returned an invalid tournament.');
      if (!request.alive || ticket !== request.ticket || request.token !== requestedToken) return null;
      setState({ token: requestedToken, tournament: data.tournament, loading: false, error: null, lastUpdated: new Date().toISOString() });
      return null;
    } catch (error) {
      if (error.name === 'AbortError' || !request.alive || ticket !== request.ticket || request.token !== requestedToken) return null;
      const message = error.status === 404 ? 'This viewer link has expired, was replaced, or its tournament was deleted.' : error.message;
      setState((previous) => ({ ...previous, token: requestedToken, loading: false, error: message, ...([401, 403, 404].includes(error.status) ? { tournament: null } : {}) }));
      return message;
    }
  }, []);
  useEffect(() => {
    const request = current.current;
    request.alive = true; request.token = token || null; request.ticket += 1;
    setState({ token: token || null, tournament: null, loading: !!token, error: null, lastUpdated: null });
    if (token) refresh();
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') refresh(); };
    const interval = token ? window.setInterval(visibleRefresh, 10_000) : null;
    window.addEventListener('focus', visibleRefresh); document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      request.alive = false; request.ticket += 1; request.controller?.abort();
      if (interval !== null) window.clearInterval(interval);
      window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [token, refresh]);
  return { ...state, tournament: state.token === (token || null) ? state.tournament : null, refresh };
}
