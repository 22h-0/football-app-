import { useRef, useState } from 'react';
import { ArrowRight, Cloud, LockKeyhole } from 'lucide-react';
import Dialog from './Dialog.jsx';

function errorMessage(result) {
  if (typeof result === 'string') return result;
  if (result instanceof Error) return result.message;
  return typeof result?.error === 'string' ? result.error : null;
}

export default function AccountDialog({ cloud, onClose, onDone }) {
  const [mode, setMode] = useState('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const unavailable = cloud.available !== true;
  const checkingAvailability = cloud.available === null;
  const registering = mode === 'register';

  function changeMode(next) {
    if (busy.current) return;
    setMode(next);
    setError('');
    setPassword('');
  }

  async function submit(event) {
    event.preventDefault();
    if (busy.current || unavailable) return;
    const normalized = username.trim();
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(normalized)) {
      setError('Use 3–30 letters, numbers, dots, underscores, or hyphens for your username.');
      return;
    }
    if (!password || password.length > 128 || (registering && password.length < 10)) {
      setError(registering ? 'Choose a password between 10 and 128 characters.' : 'Enter your password (up to 128 characters).');
      return;
    }
    busy.current = true;
    setPending(true);
    setError('');
    try {
      const result = registering
        ? await cloud.register(normalized, password)
        : await cloud.login(normalized, password);
      const message = errorMessage(result);
      if (message) { setError(message); return; }
      setPassword('');
      onDone?.();
    } catch (failure) {
      setError(failure?.message || 'Could not reach your account. Please try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return <Dialog title="Your club. Your call." className="account-dialog" onClose={() => { if (!busy.current) onClose(); }}>
    <p className="dialog-description">Save tournaments to your account and share a live, read-only link with your players.</p>
    <div className="account-tabs" role="tablist" aria-label="Account access">
      <button id="register-tab" type="button" role="tab" aria-selected={registering} aria-controls="account-panel" tabIndex={registering ? 0 : -1} disabled={pending} onClick={() => changeMode('register')} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); changeMode('login'); document.getElementById('login-tab')?.focus(); } }}>Create account</button>
      <button id="login-tab" type="button" role="tab" aria-selected={!registering} aria-controls="account-panel" tabIndex={!registering ? 0 : -1} disabled={pending} onClick={() => changeMode('login')} onKeyDown={(event) => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); changeMode('register'); document.getElementById('register-tab')?.focus(); } }}>Sign in</button>
    </div>
    {checkingAvailability ? <p className="account-field-hint" role="status">Checking account services…</p> : unavailable && <p className="form-error" role="alert">Account services are unavailable. Sign-in and live viewer links require the hosted app server. Your local roster and tournaments still work.</p>}
    <form id="account-panel" role="tabpanel" aria-labelledby={registering ? 'register-tab' : 'login-tab'} className="account-form" onSubmit={submit}>
      <label className="field-label" htmlFor="account-username">Username</label>
      <input id="account-username" className="text-input" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={30} pattern="[A-Za-z0-9._-]{3,30}" title="3–30 letters, numbers, dots, underscores, or hyphens" required value={username} onChange={(event) => setUsername(event.target.value)} disabled={pending || unavailable} autoFocus />
      <p className="account-field-hint">3–30 characters. Letters, numbers, dots, underscores, and hyphens.</p>
      <label className="field-label" htmlFor="account-password">Password</label>
      <input id="account-password" className="text-input" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={registering ? 10 : 1} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending || unavailable} aria-describedby={registering ? 'password-hint' : undefined} />
      {registering && <p id="password-hint" className="account-field-hint">At least 10 characters. Save your password somewhere safe.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary account-submit" type="submit" disabled={pending || unavailable}><Cloud size={17} />{pending ? 'Connecting…' : registering ? 'Create account' : 'Sign in'}{!pending && <ArrowRight size={17} />}</button>
    </form>
    <p className="account-privacy"><LockKeyhole size={14} />Your password is used to sign in to the app server. It is never saved in browser storage.</p>
  </Dialog>;
}
