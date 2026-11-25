import { useLayoutEffect, useRef } from 'react';

const ACTIVE = '[aria-pressed="true"], [aria-current="page"]';

/**
 * Segmented control (a row of toggle buttons) whose highlight slides to the chosen option.
 * Children are the buttons, exactly as before; the active one has aria-pressed="true".
 *
 * The highlight is one pill positioned from the active button's measured box, so it follows
 * labels of any width and wrapped rows. Until it has been measured (and wherever layout cannot
 * be measured) the active button keeps its own static highlight.
 */
export default function Segmented({ label, className = '', children }) {
  const ref = useRef(null);

  // After every render: the active option, or a label's width (e.g. a count), may have changed.
  useLayoutEffect(() => {
    const group = ref.current;
    const place = () => {
      const active = group.querySelector(ACTIVE);
      if (!active || !active.offsetWidth) {
        group.classList.remove('has-slider', 'is-sliding');
        return;
      }
      group.style.setProperty('--seg-x', `${active.offsetLeft}px`);
      group.style.setProperty('--seg-y', `${active.offsetTop}px`);
      group.style.setProperty('--seg-w', `${active.offsetWidth}px`);
      group.style.setProperty('--seg-h', `${active.offsetHeight}px`);
      group.classList.add('has-slider');
    };
    place();
    // Animate only moves that follow the first placement, never the initial appearance.
    const frame = requestAnimationFrame(() => group.classList.contains('has-slider') && group.classList.add('is-sliding'));
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(group);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  });

  return (
    <div ref={ref} className={`evsu-segmented ${className}`.trim()} role="group" aria-label={label}>
      {children}
    </div>
  );
}
