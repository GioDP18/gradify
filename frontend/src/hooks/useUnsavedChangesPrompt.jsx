import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import ConfirmDialog from '../components/common/ConfirmDialog';

/**
 * Warns before leaving a page with unsaved changes — both in-app navigation (dialog)
 * and closing/reloading the tab (browser prompt). Returns the dialog element to render.
 */
export function useUnsavedChangesPrompt(when, { message = 'You have unsaved changes. Leave this page and discard them?' } = {}) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      when && currentLocation.pathname !== nextLocation.pathname && nextLocation.pathname !== '/login',
  );

  useEffect(() => {
    if (!when) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = ''; // required by some browsers to show the prompt
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      title="Discard unsaved changes?"
      message={message}
      confirmLabel="Leave without saving"
      cancelLabel="Stay on this page"
      onConfirm={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    />
  );
}
