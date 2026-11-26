import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChatContainer, MainContainer, Message, MessageInput, MessageList, TypingIndicator } from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Bot, Calculator, Check, CircleAlert, CircleHelp, Copy, FileUp, RefreshCw, RotateCcw, Share2, SlidersHorizontal, SquarePen, UserPlus, UserX } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import * as assistantApi from '../../services/assistantApi';
import './assistant.css';

const MAX_LENGTH = 2000;
/** The character count appears only when the question is getting long. */
const COUNT_FROM = 1500;

const SUGGESTIONS = {
  INSTRUCTOR: [
    { icon: Calculator, text: 'How is the final grade computed?' },
    { icon: FileUp, text: 'How do I import students from a file?' },
    { icon: CircleHelp, text: 'Why does a student show INC?' },
    { icon: Share2, text: 'How do I share a grading sheet with a student?' },
  ],
  ADMIN: [
    { icon: UserPlus, text: 'How do I create an instructor account?' },
    { icon: SlidersHorizontal, text: 'How do I change the grading criteria?' },
    { icon: UserX, text: 'What happens when I disable an account?' },
    { icon: Calculator, text: 'How is the final grade computed?' },
  ],
};

/** The conversation is kept for this browser tab only (it is gone when the tab is closed). */
const storageKey = (userId) => `gradify-assistant:${userId}`;
function loadConversation(userId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey(userId)) ?? '[]');
    return Array.isArray(saved) ? saved.filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string') : [];
  } catch {
    return [];
  }
}
function saveConversation(userId, messages) {
  try {
    if (messages.length) sessionStorage.setItem(storageKey(userId), JSON.stringify(messages));
    else sessionStorage.removeItem(storageKey(userId));
  } catch { /* storage is full or blocked: the chat still works, it just is not kept */ }
}

/** Answers are written in Markdown (lists, bold, tables). Raw HTML in an answer is never rendered. */
const markdownParts = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _node, ...props }) => <div className="evsu-assistant__table"><table {...props} /></div>,
};
const Answer = ({ text }) => <Markdown remarkPlugins={[remarkGfm]} components={markdownParts}>{text}</Markdown>;

/** Motion is used only where the browser says it is welcome (and never in places without matchMedia). */
const motionWelcome = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches);

/**
 * A new answer is written out over about a second instead of appearing all at once, the way a
 * reply arrives in a chat. The whole answer is already here; this only paces how it is shown.
 */
function WrittenOut({ text, onProgress, onDone }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const step = Math.max(3, Math.ceil(text.length / 70));
    const timer = setInterval(() => setShown((n) => Math.min(text.length, n + step)), 16);
    return () => clearInterval(timer);
  }, [text]);
  useEffect(() => {
    onProgress?.();
    if (shown >= text.length) onDone?.();
  }, [shown, text.length, onProgress, onDone]);
  return <Answer text={text.slice(0, shown)} />;
}

/** Copies an answer (as plain text) so it can be pasted into a message or a document. */
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch { /* the browser refused; the text can still be selected and copied by hand */ }
  };
  return (
    <button type="button" className="evsu-assistant__action" onClick={copy}>
      {copied ? <><Check size={14} aria-hidden="true" /> Copied</> : <><Copy size={14} aria-hidden="true" /> Copy</>}
    </button>
  );
}

const AssistantMark = ({ size = 18 }) => <span className="evsu-assistant__mark" aria-hidden="true"><Bot size={size} /></span>;

/**
 * The Gradify Assistant: a chat that answers questions about using Gradify and how grades are
 * computed. It cannot see classes, students or grades; it only knows how Gradify works.
 */
export default function AssistantPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState(() => loadConversation(user.id));
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [writing, setWriting] = useState(null); // index of the answer being written out
  const sendingRef = useRef(false);
  const list = useRef(null);

  const status = useQuery({ queryKey: ['assistant'], queryFn: assistantApi.getAssistant, staleTime: 5 * 60 * 1000 });
  const unavailable = status.data?.available === false;

  useEffect(() => saveConversation(user.id, messages), [user.id, messages]);
  // Keep the newest message in view (also when returning to a saved conversation).
  const toBottom = useCallback(() => list.current?.scrollToBottom?.('auto'), []);
  useEffect(() => {
    const frame = requestAnimationFrame(toBottom);
    return () => cancelAnimationFrame(frame);
  }, [messages, sending, error, toBottom]);
  const doneWriting = useCallback(() => setWriting(null), []);

  /** Sends the conversation (which ends with a question) and adds the answer. */
  const ask = useCallback(async (conversation) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const { reply } = await assistantApi.sendChat(conversation);
      setMessages((current) => {
        if (current !== conversation) return current; // a new chat was started meanwhile
        if (motionWelcome()) setWriting(conversation.length);
        return [...conversation, { role: 'assistant', content: reply }];
      });
    } catch (failure) {
      setError(failure.message || 'The assistant could not answer right now. Please try again.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, []);

  const send = (text) => {
    const question = String(text ?? '').trim();
    if (!question || question.length > MAX_LENGTH || sendingRef.current || unavailable) return;
    // After a failed attempt the unanswered question is replaced, so the conversation still alternates.
    const base = messages.at(-1)?.role === 'user' ? messages.slice(0, -1) : messages;
    const conversation = [...base, { role: 'user', content: question }];
    setMessages(conversation);
    setDraft('');
    setWriting(null);
    ask(conversation);
  };

  /** Asks the last question again for a different answer. */
  const regenerate = () => {
    if (sendingRef.current || messages.at(-1)?.role !== 'assistant') return;
    const conversation = messages.slice(0, -1);
    setMessages(conversation);
    setWriting(null);
    ask(conversation);
  };

  const newChat = () => {
    setMessages([]);
    setError(null);
    setDraft('');
    setWriting(null);
  };

  const draftLength = draft.trim().length;
  const tooLong = draftLength > MAX_LENGTH;
  const empty = messages.length === 0;
  const canSend = !sending && !tooLong && draftLength > 0 && !unavailable;
  const lastAnswer = !sending && messages.at(-1)?.role === 'assistant' ? messages.at(-1).content : '';
  const firstName = user.name?.split(' ')[0] ?? 'there';

  return (
    <div className="evsu-assistant">
      <section className={`evsu-assistant__panel ${empty ? 'is-empty' : ''}`} aria-label="Gradify Assistant">
        <header className="evsu-assistant__head">
          <AssistantMark />
          <h2 className="evsu-assistant__name">Gradify Assistant</h2>
          <span className={`evsu-assistant__state ${unavailable ? 'is-off' : ''}`}>{unavailable ? 'Not turned on' : sending ? 'Typing…' : 'Online'}</span>
          <button type="button" className="evsu-assistant__new" onClick={newChat} disabled={empty || sending}>
            <SquarePen size={16} aria-hidden="true" /> New chat
          </button>
        </header>

        {empty && (
          <div className="evsu-assistant__welcome">
            <AssistantMark size={30} />
            <h3 className="evsu-assistant__greeting">Hi {firstName}, how can I help?</h3>
            {unavailable ? (
              <p className="evsu-assistant__off" role="status">
                <CircleAlert size={16} aria-hidden="true" /> The assistant is not turned on yet.
                {user.role === 'ADMIN' ? ' It needs to be set up on the server before it can answer.' : ' Ask your Gradify administrator to turn it on.'}
              </p>
            ) : (
              <p className="evsu-assistant__lead">Ask how to do something in Gradify, or how a grade is computed.</p>
            )}
          </div>
        )}

        <div className="evsu-assistant__chat">
          <MainContainer>
            <ChatContainer>
              <MessageList ref={list} autoScrollToBottom autoScrollToBottomOnMount scrollBehavior="smooth">
                {messages.map((message, index) => {
                  const isLast = index === messages.length - 1;
                  return message.role === 'user' ? (
                    // eslint-disable-next-line react/no-array-index-key -- a conversation only grows at the end
                    <Message key={index} model={{ direction: 'outgoing', position: 'single', sender: 'You' }}>
                      <Message.CustomContent><p className="evsu-assistant__question">{message.content}</p></Message.CustomContent>
                    </Message>
                  ) : (
                    // eslint-disable-next-line react/no-array-index-key
                    <Message key={index} model={{ direction: 'incoming', position: 'single', sender: 'Assistant' }}>
                      <Message.CustomContent>
                        <div className="evsu-assistant__answer">
                          {writing === index ? <WrittenOut text={message.content} onProgress={toBottom} onDone={doneWriting} /> : <Answer text={message.content} />}
                        </div>
                        {writing !== index && (
                          <div className="evsu-assistant__actions">
                            <CopyButton text={message.content} />
                            {isLast && !sending && (
                              <button type="button" className="evsu-assistant__action" onClick={regenerate}>
                                <RefreshCw size={14} aria-hidden="true" /> Regenerate
                              </button>
                            )}
                          </div>
                        )}
                      </Message.CustomContent>
                    </Message>
                  );
                })}

                {/* While the answer is on its way: moving dots where the answer will appear */}
                {sending && (
                  <Message model={{ direction: 'incoming', position: 'single', sender: 'Assistant' }} className="evsu-assistant__typing">
                    <Message.CustomContent>
                      <TypingIndicator />
                      <span className="visually-hidden">The assistant is typing</span>
                    </Message.CustomContent>
                  </Message>
                )}

                {error && (
                  <MessageList.Content className="evsu-assistant__error" role="alert">
                    <CircleAlert size={16} aria-hidden="true" />
                    <span>{error}</span>
                    {messages.at(-1)?.role === 'user' && (
                      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => ask(messages)} disabled={sending}>
                        <RotateCcw size={14} aria-hidden="true" /> Try again
                      </button>
                    )}
                  </MessageList.Content>
                )}
              </MessageList>
            </ChatContainer>
          </MainContainer>
        </div>

        <div className="evsu-assistant__dock">
          <div className={`evsu-assistant__composer ${tooLong ? 'is-invalid' : ''} ${unavailable ? 'is-disabled' : ''}`}>
            <MessageInput
              placeholder={unavailable ? 'The assistant is not turned on yet' : 'Ask anything about Gradify…'}
              aria-label="Your question"
              value={draft}
              onChange={(_html, text) => setDraft(text)}
              onSend={(_html, text) => send(text)}
              onPaste={(event) => {
                // paste as plain text (never the formatting of the page it was copied from)
                event.preventDefault();
                setDraft((current) => current + event.clipboardData.getData('text'));
              }}
              attachButton={false}
              sendButton={false}
              disabled={unavailable}
              sendDisabled={!canSend}
              autoFocus
            />
            <button type="button" className="evsu-assistant__send" onClick={() => send(draft)} disabled={!canSend} aria-label="Send">
              <ArrowUp size={18} strokeWidth={2.5} aria-hidden="true" />
            </button>
          </div>

          {empty && !unavailable && (
            <ul className="evsu-assistant__suggestions" aria-label="Suggested questions">
              {(SUGGESTIONS[user.role] ?? SUGGESTIONS.INSTRUCTOR).map(({ icon: Icon, text }) => (
                <li key={text}>
                  <button type="button" className="evsu-assistant__suggestion" onClick={() => send(text)} disabled={sending}>
                    <Icon size={15} aria-hidden="true" />{text}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="evsu-assistant__note">
            {tooLong ? (
              <span className="text-danger" role="alert">That is {draftLength.toLocaleString()} characters. Keep a question under {MAX_LENGTH.toLocaleString()}.</span>
            ) : (
              <>
                The assistant cannot see your classes or grades. Do not type passwords or students&rsquo; personal details. Answers can be wrong; check anything important.
                {draftLength >= COUNT_FROM && <span className="evsu-assistant__count" aria-hidden="true"> {draftLength.toLocaleString()} / {MAX_LENGTH.toLocaleString()}</span>}
              </>
            )}
          </p>
        </div>
      </section>

      {/* Screen readers hear each answer when it arrives */}
      <div className="visually-hidden" role="status" aria-live="polite">{sending ? 'The assistant is typing' : lastAnswer}</div>
    </div>
  );
}
