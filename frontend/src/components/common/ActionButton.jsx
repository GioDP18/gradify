import { useEffect, useRef, useState } from 'react';
import Spinner from './Spinner';

/**
 * A button for an action that takes time (saving, signing out, reloading). While the action runs
 * the button is disabled and shows a spinner, so it cannot be clicked twice.
 *
 * It is busy while `busy` is true, and also while the promise returned by `onClick` is pending,
 * so `onClick={() => save()}` is enough when `save` is async. The spinner takes the place of
 * `icon`; `busyLabel` optionally replaces the text ("Saving…").
 */
export default function ActionButton({ onClick, busy: busyProp = false, disabled = false, icon: Icon, iconSize = 16, busyLabel, spinnerClassName, className = '', children, ...props }) {
  const [pending, setPending] = useState(false);
  const running = useRef(false); // set at once, before React re-renders, so a fast double click is ignored
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const busy = busyProp || pending;
  const handleClick = (event) => {
    if (running.current) return;
    const result = onClick?.(event);
    if (result && typeof result.then === 'function') {
      running.current = true;
      setPending(true);
      const done = () => {
        running.current = false;
        if (mounted.current) setPending(false);
      };
      result.then(done, done);
    }
  };

  // Buttons laid out with a flex gap space the spinner themselves; plain ones need a margin.
  const spaced = /(^|\s)gap-\d/.test(className) || children === undefined || children === null;
  return (
    <button type="button" {...props} className={className} onClick={handleClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? <Spinner size="sm" label="" className={spinnerClassName ?? (spaced ? '' : 'me-2')} /> : Icon ? <Icon size={iconSize} aria-hidden="true" /> : null}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
