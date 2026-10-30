import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Eye, Link2, RefreshCw } from 'lucide-react';
import Dialog from './Dialog.jsx';

export default function ViewerLinkDialog({ tournament, existingPath, onCreate, onCreated, onClose, onToast }) {
  const [sharePath, setSharePath] = useState(existingPath || '');
  const [pending, setPending] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const input = useRef(null);
  const busy = useRef(false);
  const url = sharePath ? new URL(sharePath, window.location.origin).href : '';

  useEffect(() => { if (existingPath) setSharePath(existingPath); }, [existingPath]);

  async function create() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    setCopied(false);
    setManualCopy(false);
    try {
      const result = await onCreate(tournament.id);
      if (result?.error) { setError(typeof result.error === 'string' ? result.error : 'Could not create a viewer link. Please try again.'); return; }
      if (typeof result?.sharePath !== 'string' || !/^\/watch\/[A-Za-z0-9_-]+$/.test(result.sharePath)) {
        setError('The server did not return a valid viewer link. Please try again.');
        return;
      }
      setSharePath(result.sharePath);
      setConfirmReplace(false);
      onCreated?.(result.sharePath);
      onToast?.(sharePath ? 'Viewer link replaced. The old link no longer works.' : 'Your read-only viewer link is ready.');
    } catch (failure) {
      setError(failure?.message || 'Could not create a viewer link. Check your connection and try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function copy() {
    if (!url || copying) return;
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setManualCopy(false);
      onToast?.('Viewer link copied. Share it with your players.');
    } catch {
      setManualCopy(true);
      input.current?.focus();
      input.current?.select();
    } finally { setCopying(false); }
  }

  return <Dialog title="Your group. Front-row seats." className="viewer-link-dialog" onClose={() => { if (!busy.current) onClose(); }}>
    <p className="dialog-description">Give your players a live view of <strong>{tournament.name}</strong>—fixtures, results, standings, and goalscorers.</p>
    <div className="viewer-permissions"><Eye size={20} /><div><strong>Watch, without changing a thing.</strong><p>Anyone with this link can view the tournament. Only your signed-in account can edit it. Changes appear as the viewer checks for updates.</p></div></div>
    {sharePath ? <>
      <label className="field-label" htmlFor="viewer-link">Read-only tournament link</label>
      <div className="viewer-link-field"><input ref={input} id="viewer-link" className="text-input" value={url} readOnly onFocus={(event) => event.target.select()} /><button className="button button-primary" type="button" onClick={copy} disabled={copying || pending}>{copied ? <Check size={16} /> : <Copy size={16} />}{copying ? 'Copying…' : copied ? 'Copied' : 'Copy link'}</button></div>
      {manualCopy && <p className="viewer-copy-help" role="status">The link is selected. Copy it with your keyboard or press and hold to copy on your phone.</p>}
      <div className="viewer-replace"><p>Need to stop an old link from working? Replace it and share the new one. Previously copied links will immediately stop opening the tournament.</p>{confirmReplace ? <div className="viewer-replace-confirm"><p><strong>Replace this viewer link?</strong> Everyone using the previous link will need the new one.</p><div><button type="button" className="button button-secondary button-small" onClick={() => setConfirmReplace(false)} disabled={pending}>Keep current link</button><button type="button" className="button button-danger button-small" onClick={create} disabled={pending}><RefreshCw size={14} />{pending ? 'Replacing…' : 'Replace link'}</button></div></div> : <button type="button" className="text-button" onClick={() => setConfirmReplace(true)} disabled={pending}><RefreshCw size={14} />Replace viewer link</button>}</div>
    </> : <><p className="viewer-link-note">Creating a viewer link enables read-only access to this tournament. If you have created a link before, it will be replaced and will stop working.</p><button type="button" className="button button-primary viewer-create" onClick={create} disabled={pending}><Link2 size={17} />{pending ? 'Creating link…' : 'Create / renew viewer link'}</button></>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={pending}>Done</button></div>
  </Dialog>;
}
