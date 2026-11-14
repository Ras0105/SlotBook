import { API_URL } from '../api/client';
import { initials } from './Avatar';

// A provider's photo / logo, or their initials when they have not added one.
// Decorative: the name is always written out next to it, so the picture has an empty alt.
export default function ProviderAvatar({ provider, size = 'md' }) {
  const src = provider.photo_url ? `${API_URL}${provider.photo_url}` : null;
  return src ? (
    <img className={`provider-avatar provider-avatar--${size}`} src={src} alt="" loading="lazy" width="400" height="400" />
  ) : (
    <span className={`provider-avatar provider-avatar--${size} provider-avatar--initials`} aria-hidden="true">
      {initials(provider.service_name)}
    </span>
  );
}
