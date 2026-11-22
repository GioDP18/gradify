import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { loadingProgress } from '../../services/loadingProgress';

const SHOW_DELAY_MS = 150; // quick requests finish before the bar would even appear
const SLOW_AFTER_MS = 8000; // then a note says the connection may be slow
const TRICKLE_MS = 400;

/**
 * Thin bar across the top of the window while anything loads. It creeps toward 90% while work
 * is pending (slower the closer it gets), so a slow connection shows as a slow crawl, then
 * completes and fades when everything is done.
 */
export default function TopProgressBar() {
  const active = useSyncExternalStore(loadingProgress.subscribe, loadingProgress.getActive, () => 0);
  const busy = active > 0;
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    if (busy) {
      const timers = [];
      let trickle;
      timers.push(setTimeout(() => {
        shown.current = true;
        setVisible(true);
        setWidth((w) => Math.max(w, 8));
        trickle = setInterval(() => setWidth((w) => (w < 90 ? w + (90 - w) * (w < 50 ? 0.12 : 0.05) : w)), TRICKLE_MS);
      }, shown.current ? 0 : SHOW_DELAY_MS));
      timers.push(setTimeout(() => setSlow(true), SLOW_AFTER_MS));
      return () => {
        timers.forEach(clearTimeout);
        clearInterval(trickle);
      };
    }
    setSlow(false);
    if (!shown.current) return undefined;
    // Finish: fill, fade out, reset.
    setWidth(100);
    const fade = setTimeout(() => setVisible(false), 250);
    const reset = setTimeout(() => {
      shown.current = false;
      setWidth(0);
    }, 650);
    return () => {
      clearTimeout(fade);
      clearTimeout(reset);
    };
  }, [busy]);

  return (
    <>
      <div className={`evsu-progress ${visible ? 'is-visible' : ''}`} aria-hidden="true">
        <div className="evsu-progress__bar" style={{ width: `${width}%` }} />
      </div>
      <div className="evsu-progress__slow" role="status" aria-live="polite">
        {slow && busy ? <span>Still loading. Your connection may be slow.</span> : null}
      </div>
    </>
  );
}
