import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChatContainer, MainContainer, Message, MessageInput, MessageList, TypingIndicator } from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Bot, Calculator, Check, CircleAlert, CircleHelp, Copy, History, MessageSquare, RefreshCw, Trash2, X, RotateCcw, School, SlidersHorizontal, SquarePen, TriangleAlert, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import * as assistantApi from '../../services/assistantApi';
import { chatDayLabel, clearChatHistory } from '../../utils/chatHistory';
import { useToast } from '../../components/common/Toast';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import './assistant.css';

const MAX_LENGTH = 2000;
/** The cached list of the account's saved chats. */
export const CHATS_KEY = ['assistant-chats'];
/** The character count appears only when the question is getting long. */
const COUNT_FROM = 1500;

const SUGGESTIONS = {
  INSTRUCTOR: [
    { icon: School, text: 'How many classes and students do I have?' },
    { icon: TriangleAlert, text: 'Which students are failing?' },
    { icon: CircleHelp, text: 'Who has an INC, and what are they missing?' },
    { icon: Calculator, text: 'How is the final grade computed?' },
  ],
  ADMIN: [
    { icon: Users, text: 'How many instructor accounts are there?' },
    { icon: UserPlus, text: 'How do I create an instructor account?' },
    { icon: SlidersHorizontal, text: 'How do I change the grading criteria?' },
    { icon: Calculator, text: 'How is the final grade computed?' },
  ],
};

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
 * computed, and about the signed-in person's own records (an instructor's classes, students,
 * attendance and grades; the administrator's instructor accounts). It can read, never change.
 */
export default function AssistantPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Settings > Assistant > Keep chat history: when on, chats are saved to the account (the same on every device).
  const keepHistory = user.preferences?.chatHistory ?? true;
  const chatsQuery = useQuery({ queryKey: CHATS_KEY, queryFn: assistantApi.listChats, enabled: keepHistory });
  const chats = useMemo(() => (keepHistory ? chatsQuery.data ?? [] : []), [keepHistory, chatsQuery.data]);
  // The open chat: its id once it is saved (null for a new chat), and its messages.
  const [chatId, setChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [opening, setOpening] = useState(null); // id of the saved chat being opened
  const [removing, setRemoving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // phones: the history panel slides over the chat
  const [deleting, setDeleting] = useState(null); // the chat waiting for "Delete" to be confirmed
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [writing, setWriting] = useState(null); // index of the answer being written out
  const sendingRef = useRef(false);
  const list = useRef(null);

  const status = useQuery({ queryKey: ['assistant'], queryFn: assistantApi.getAssistant, staleTime: 5 * 60 * 1000 });
  const unavailable = status.data?.available === false;

  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
  // Conversations an earlier version left in this browser's storage are removed.
  useEffect(() => clearChatHistory(), []);

  /** The list in groups: Today, Yesterday, Earlier this week, Older. */
  const groups = useMemo(() => {
    const byDay = [];
    for (const chat of chats) {
      const label = chatDayLabel(chat.updatedAt);
      if (byDay.at(-1)?.label === label) byDay.at(-1).chats.push(chat);
      else byDay.push({ label, chats: [chat] });
    }
    return byDay;
  }, [chats]);
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
      const { reply, chat } = await assistantApi.sendChat(conversation, chatIdRef.current);
      // The server saved the conversation to the account: note which chat it is and move it to the top of the list.
      if (chat) {
        setChatId(chat.id);
        queryClient.setQueryData(CHATS_KEY, (current = []) => [chat, ...current.filter((c) => c.id !== chat.id)]);
      }
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
  }, [queryClient]);

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

  const openChat = async (chat) => {
    if (sendingRef.current || opening) return;
    setHistoryOpen(false);
    if (chat.id === chatId) return;
    setOpening(chat.id);
    try {
      const saved = await assistantApi.getChat(chat.id);
      setChatId(saved.id);
      setMessages(saved.messages);
      setError(null);
      setDraft('');
      setWriting(null);
    } catch (failure) {
      toast.error(failure.message || 'That chat could not be opened. Please try again.');
      if (failure.status === 404) queryClient.invalidateQueries({ queryKey: CHATS_KEY }); // it was deleted elsewhere
    } finally {
      setOpening(null);
    }
  };

  const deleteChat = async (chat) => {
    setRemoving(true);
    try {
      await assistantApi.deleteChat(chat.id);
    } catch (failure) {
      if (failure.status !== 404) { // already gone is as good as deleted
        toast.error(failure.message || 'That chat could not be deleted. Please try again.');
        setRemoving(false);
        return;
      }
    }
    queryClient.setQueryData(CHATS_KEY, (current = []) => current.filter((c) => c.id !== chat.id));
    setRemoving(false);
    setDeleting(null);
    if (chat.id === chatId) newChat();
  };

  const newChat = () => {
    setChatId(null);
    setHistoryOpen(false);
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
      <div className={`evsu-assistant__layout ${keepHistory ? 'has-history' : ''} ${historyOpen ? 'is-history-open' : ''}`}>
      {keepHistory && (
        <>
          <nav className="evsu-assistant__history" aria-label="Chat history">
            <div className="evsu-assistant__history-top">
              <button type="button" className="evsu-assistant__new-chat" onClick={newChat} disabled={(empty && !chatId) || sending}>
                <SquarePen size={16} aria-hidden="true" /> New chat
              </button>
              <button type="button" className="evsu-assistant__history-close" onClick={() => setHistoryOpen(false)} aria-label="Close chat history">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="evsu-assistant__history-list">
              {chatsQuery.isPending && <p className="evsu-assistant__history-empty" role="status">Loading your chats…</p>}
              {chatsQuery.isError && (
                <p className="evsu-assistant__history-empty" role="alert">
                  Your chats could not be loaded.
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => chatsQuery.refetch()}>Try again</button>
                </p>
              )}
              {chatsQuery.isSuccess && groups.length === 0 && <p className="evsu-assistant__history-empty"><MessageSquare size={18} aria-hidden="true" />Your chats will be listed here.</p>}
              {groups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <h3 className="evsu-assistant__history-day">{group.label}</h3>
                  <ul>
                    {group.chats.map((chat) => (
                      <li key={chat.id} className={`${chat.id === chatId ? 'is-current' : ''} ${chat.id === opening ? 'is-opening' : ''}`}>
                        <button type="button" className="evsu-assistant__history-item" onClick={() => openChat(chat)} disabled={sending || Boolean(opening)} aria-current={chat.id === chatId ? 'true' : undefined} aria-busy={chat.id === opening || undefined} title={chat.title}>
                          {chat.title}
                        </button>
                        <button type="button" className="evsu-assistant__history-delete" onClick={() => setDeleting(chat)} disabled={sending} aria-label={`Delete chat: ${chat.title}`}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <p className="evsu-assistant__history-note">You can turn off your chat history anytime in <Link to="/settings">Settings</Link>.</p>
          </nav>
          <button type="button" className="evsu-assistant__history-backdrop" onClick={() => setHistoryOpen(false)} aria-label="Close chat history" tabIndex={-1} />
        </>
      )}

      <section className={`evsu-assistant__panel ${empty ? 'is-empty' : ''}`} aria-label="Gradify Assistant">
        <header className="evsu-assistant__head">
          {keepHistory && (
            <button type="button" className="evsu-assistant__history-open" onClick={() => setHistoryOpen(true)} aria-label="Chat history" aria-expanded={historyOpen}>
              <History size={18} aria-hidden="true" />
            </button>
          )}
          <AssistantMark />
          <h2 className="evsu-assistant__name">Gradify Assistant</h2>
          <span className={`evsu-assistant__state ${unavailable ? 'is-off' : ''}`}>{unavailable ? 'Not turned on' : sending ? 'Typing…' : 'Online'}</span>
          {!keepHistory && (
            <button type="button" className="evsu-assistant__new" onClick={newChat} disabled={empty || sending}>
              <SquarePen size={16} aria-hidden="true" /> New chat
            </button>
          )}
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
              <p className="evsu-assistant__lead">{user.role === 'ADMIN' ? 'Ask about the instructor accounts, or how to do something in Gradify.' : 'Ask about your classes, students and grades, or how to do something in Gradify.'}</p>
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
              placeholder={unavailable ? 'The assistant is not turned on yet' : user.role === 'ADMIN' ? 'Ask anything about Gradify…' : 'Ask about your classes, students or grades…'}
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
                {user.role === 'ADMIN' ? 'The assistant can look up the instructor accounts to answer you.' : 'The assistant can look up your own classes, students and grades to answer you.'} It cannot change anything. Do not type passwords. Answers can be wrong; check anything important.
                {draftLength >= COUNT_FROM && <span className="evsu-assistant__count" aria-hidden="true"> {draftLength.toLocaleString()} / {MAX_LENGTH.toLocaleString()}</span>}
              </>
            )}
          </p>
        </div>
      </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this chat?"
        message={<>“{deleting?.title}” will be deleted from your account, on every device. This cannot be undone.</>}
        confirmLabel="Delete"
        busy={removing}
        onConfirm={() => deleteChat(deleting)}
        onCancel={() => setDeleting(null)}
      />

      {/* Screen readers hear each answer when it arrives */}
      <div className="visually-hidden" role="status" aria-live="polite">{sending ? 'The assistant is typing' : lastAnswer}</div>
    </div>
  );
}
