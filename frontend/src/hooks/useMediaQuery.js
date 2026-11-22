import { useEffect, useState } from 'react';

/** True while the media query matches (e.g. narrow screens). Safe where matchMedia is missing. */
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Chart x-axis props: tilted labels on phones so band labels like "1.0–1.4" never overlap. */
export function useCategoryAxisProps() {
  const narrow = useMediaQuery('(max-width: 575.98px)');
  return narrow
    ? { interval: 0, angle: -40, textAnchor: 'end', height: 48, tick: { fontSize: 10 } }
    : { interval: 0, tick: { fontSize: 11 } };
}
