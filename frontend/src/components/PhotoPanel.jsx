import { useRef, useState } from 'react';
import { deleteMyPhoto, uploadMyPhoto } from '../api';
import { friendlyError } from '../lib/errors';
import { ACCEPTED_TYPES, checkImageFile, squareThumbnail } from '../lib/image';
import Alert from './Alert';
import ProviderAvatar from './ProviderAvatar';

/** Upload, replace or remove the provider's photo / logo. onChanged(provider) gets the updated profile. */
export default function PhotoPanel({ provider, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  async function run(work, message) {
    setBusy(true);
    setError('');
    setDone('');
    try {
      onChanged(await work());
      setDone(message);
    } catch (err) {
      setError(err.status ? friendlyError(err) : err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onPick(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // so choosing the same file again still fires
    if (!file) return;
    const problem = checkImageFile(file);
    if (problem) {
      setError(problem);
      setDone('');
      return;
    }
    await run(async () => uploadMyPhoto(await squareThumbnail(file)), 'Photo saved.');
  }

  return (
    <section className="photo-panel" aria-labelledby="photo-heading">
      <h2 id="photo-heading">Photo or logo</h2>
      <div className="photo-panel__row">
        <ProviderAvatar provider={provider} size="xl" />
        <div>
          <p className="muted">Shown on the provider list and on your page. It is cropped to a square.</p>
          <div className="form__buttons">
            <input
              ref={input}
              id="photo-file"
              className="visually-hidden"
              type="file"
              accept={ACCEPTED_TYPES.join(',')}
              onChange={onPick}
              disabled={busy}
              tabIndex={-1}
              aria-label="Choose a photo or logo"
            />
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Working…' : provider.photo_url ? 'Change photo' : 'Upload photo'}
            </button>
            {provider.photo_url && (
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => run(deleteMyPhoto, 'Photo removed.')}
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
      </div>
      {error && <Alert kind="error" onDismiss={() => setError('')}>{error}</Alert>}
      {done && <Alert kind="success" onDismiss={() => setDone('')}>{done}</Alert>}
    </section>
  );
}
