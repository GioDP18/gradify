import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAvatar } from '../../services/authApi';

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

/**
 * The signed-in user's photo as an object URL, or null. The photo is private (fetched with the
 * session token), cached per `avatarUpdatedAt`, so every place showing it shares one download.
 */
export function useAvatarSrc(user) {
  const version = user?.avatarUpdatedAt ?? null;
  const { data: blob } = useQuery({
    queryKey: ['avatar', user?.id, version],
    queryFn: () => fetchAvatar(version),
    enabled: Boolean(user?.id && version),
    staleTime: Infinity,
    retry: false,
  });
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!version || !blob) {
      setSrc(null);
      return undefined;
    }
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob, version]);
  return src;
}

/** Round avatar: the user's photo when there is one, otherwise their initials. Decorative. */
export default function Avatar({ user, className = '' }) {
  const src = useAvatarSrc(user);
  return (
    <span className={`evsu-avatar ${src ? 'has-photo' : ''} ${className}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : initials(user?.name)}
    </span>
  );
}
