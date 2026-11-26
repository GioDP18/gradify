import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import Spinner from '../../components/common/Spinner';

/**
 * The support chat box on the sign-in pages: a round button in the corner that opens a small
 * panel with the Gradify AI assistant inside a frame.
 *
 * The assistant's page is fetched only once the box is first opened. After that the frame is kept
 * (hidden) while the box is closed, so reopening it continues the same conversation.
 */
export default function SupportChat({ url, open, onOpen, onClose }) {
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const launcher = useRef(null);
  const closeButton = useRef(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      setStarted(true);
      closeButton.current?.focus();
    } else if (wasOpen.current) {
      launcher.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <section className={`lg-chat ${open ? 'is-open' : ''}`} role="dialog" aria-label="Gradify support chat" hidden={!open}>
        <header className="lg-chat__bar">
          <span className="lg-chat__title"><MessageCircle aria-hidden="true" /> Gradify support</span>
          <button ref={closeButton} type="button" className="lg-chat__close" onClick={onClose} aria-label="Close chat">
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="lg-chat__body">
          {!ready && <div className="lg-chat__wait"><Spinner label="Opening chat…" /></div>}
          {started && (
            <iframe
              src={url}
              title="Gradify support assistant"
              className="lg-chat__frame"
              onLoad={() => setReady(true)}
              allow="clipboard-write"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="strict-origin"
            />
          )}
        </div>
      </section>

      {!open && (
        <button ref={launcher} type="button" className="lg-chat__launcher" onClick={onOpen} aria-label="Chat with Gradify support">
          <MessageCircle aria-hidden="true" />
        </button>
      )}
    </>
  );
}
