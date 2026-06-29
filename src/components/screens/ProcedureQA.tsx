import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  MessageSquare, Plus, Trash2, Send, Loader as Loader2,
  ChevronDown, ChevronUp, Settings2, Bot, User,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MARKETS, JOURNEYS } from '@/lib/constants';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface ChatSession {
  id: string;
  title: string;
  market: string;
  journey: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

// ── LocalStorage helpers ──────────────────────────────────────────────────────
const LS_KEY        = 'pqa_sessions';
const LS_ACTIVE_KEY = 'pqa_active';

function loadSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(sessions));
}

function newSession(market = '', journey = ''): ChatSession {
  return {
    id: crypto.randomUUID(),
    title: 'New Chat',
    market,
    journey,
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function titleFromMessage(content: string): string {
  return content.length > 48 ? content.slice(0, 48) + '…' : content;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function ProcedureQA() {
  const [sessions, setSessions]         = useState<ChatSession[]>(() => loadSessions());
  const [activeId, setActiveId]         = useState<string | null>(() => localStorage.getItem(LS_ACTIVE_KEY));
  const [input, setInput]               = useState('');
  const [streaming, setStreaming]       = useState(false);
  const [showFilters, setShowFilters]   = useState(false);
  const [sidebarOpen, setSidebarOpen]   = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef    = useRef<HTMLTextAreaElement>(null);
  const abortRef       = useRef<AbortController | null>(null);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  // Persist sessions whenever they change
  useEffect(() => { saveSessions(sessions); }, [sessions]);

  // Persist active session id
  useEffect(() => {
    if (activeId) localStorage.setItem(LS_ACTIVE_KEY, activeId);
    else localStorage.removeItem(LS_ACTIVE_KEY);
  }, [activeId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeSession?.messages.length, streaming]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  // Cancel on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const startNewChat = useCallback(() => {
    const session = newSession(activeSession?.market ?? '', activeSession?.journey ?? '');
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    setInput('');
  }, [activeSession]);

  const deleteSession = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveId((prev) => (prev === id ? null : prev));
  }, []);

  const updateSession = useCallback((id: string, patch: Partial<ChatSession>) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s))
    );
  }, []);

  const setMarket = useCallback((v: string) => {
    if (activeId) updateSession(activeId, { market: v });
  }, [activeId, updateSession]);

  const setJourney = useCallback((v: string) => {
    if (activeId) updateSession(activeId, { journey: v });
  }, [activeId, updateSession]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    // Ensure we have an active session
    let sessionId = activeId;
    if (!sessionId || !sessions.find((s) => s.id === sessionId)) {
      const session = newSession();
      setSessions((prev) => [session, ...prev]);
      setActiveId(session.id);
      sessionId = session.id;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    const assistantMsgId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };

    // Get current session state synchronously for the API call
    const session = sessions.find((s) => s.id === sessionId);
    const history = session?.messages ?? [];
    const market  = session?.market  ?? '';
    const journey = session?.journey ?? '';

    // Optimistically add messages
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sessionId) return s;
        const updated = { ...s, messages: [...s.messages, userMsg, assistantMsg], updatedAt: new Date().toISOString() };
        if (s.messages.length === 0) updated.title = titleFromMessage(text);
        return updated;
      })
    );
    setInput('');
    setStreaming(true);

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const apiMessages = [
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: text },
      ];

      const resp = await fetch(`${supabaseUrl}/functions/v1/procedure-qa`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: apiMessages, market, journey }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Request failed');
        throw new Error(errText);
      }

      const reader  = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          try {
            const { content } = JSON.parse(trimmed.slice(6));
            if (content) {
              accumulated += content;
              setSessions((prev) =>
                prev.map((s) => {
                  if (s.id !== sessionId) return s;
                  return {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: accumulated } : m
                    ),
                  };
                })
              );
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      const errContent = `Sorry, something went wrong: ${err.message}`;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            messages: s.messages.map((m) =>
              m.id === assistantMsgId ? { ...m, content: errContent } : m
            ),
          };
        })
      );
    } finally {
      setStreaming(false);
    }
  }, [input, streaming, activeId, sessions]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* ── Sidebar ── */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col border-r border-gray-100 bg-gray-50 overflow-hidden flex-shrink-0"
          >
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Conversations</span>
              <button
                onClick={startNewChat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#DB0011] text-white text-xs font-medium hover:bg-red-700 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> New
              </button>
            </div>

            {/* Session list */}
            <div className="flex-1 overflow-y-auto py-2">
              {sessions.length === 0 && (
                <p className="text-xs text-gray-400 text-center mt-8 px-4">
                  No conversations yet. Start a new chat!
                </p>
              )}
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setActiveId(session.id)}
                  className={cn(
                    'w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-gray-100 transition-colors group',
                    activeId === session.id && 'bg-white border-r-2 border-r-[#DB0011]'
                  )}
                >
                  <MessageSquare className="h-4 w-4 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{session.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate">
                      {[session.market, session.journey].filter(Boolean).join(' · ') || 'No context set'}
                    </p>
                  </div>
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </button>
              ))}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main chat area ── */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 flex-shrink-0">
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            title="Toggle sidebar"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-gray-900 truncate">
              {activeSession?.title ?? 'Procedure Q&A'}
            </h1>
            {activeSession && (
              <p className="text-xs text-gray-400">
                {[activeSession.market, activeSession.journey].filter(Boolean).join(' · ') || 'No context — set market & journey below'}
              </p>
            )}
          </div>
          {activeSession && (
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                showFilters
                  ? 'bg-gray-100 border-gray-200 text-gray-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              )}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Context
              {showFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          )}
        </div>

        {/* Context filters (collapsible) */}
        <AnimatePresence initial={false}>
          {showFilters && activeSession && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden border-b border-gray-100 bg-gray-50"
            >
              <div className="flex items-center gap-4 px-5 py-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-500 w-14">Market</label>
                  <Select value={activeSession.market} onValueChange={setMarket}>
                    <SelectTrigger className="h-8 text-xs w-36">
                      <SelectValue placeholder="Select market" />
                    </SelectTrigger>
                    <SelectContent>
                      {MARKETS.map((m) => <SelectItem key={m} value={m} className="text-xs">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-gray-500 w-14">Journey</label>
                  <Select value={activeSession.journey} onValueChange={setJourney}>
                    <SelectTrigger className="h-8 text-xs w-44">
                      <SelectValue placeholder="Select journey" />
                    </SelectTrigger>
                    <SelectContent>
                      {JOURNEYS.map((j) => <SelectItem key={j} value={j} className="text-xs">{j}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {!activeSession && (
            <EmptyState onNew={startNewChat} />
          )}
          {activeSession && activeSession.messages.length === 0 && (
            <WelcomeScreen market={activeSession.market} journey={activeSession.journey} />
          )}
          {activeSession?.messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={streaming && idx === activeSession.messages.length - 1 && msg.role === 'assistant'}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="flex-shrink-0 px-5 pb-5 pt-3 border-t border-gray-100 bg-white">
          <div className="flex items-end gap-3 max-w-3xl mx-auto">
            <div className="flex-1 relative rounded-2xl border border-gray-200 bg-gray-50 focus-within:bg-white focus-within:border-gray-300 focus-within:ring-2 focus-within:ring-[#DB0011]/20 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  activeSession
                    ? 'Ask about any banking procedure… (Enter to send, Shift+Enter for new line)'
                    : 'Start a new conversation to ask questions…'
                }
                disabled={streaming || !activeSession}
                rows={1}
                className="w-full resize-none bg-transparent text-sm text-gray-900 px-4 py-3.5 pr-14 focus:outline-none placeholder:text-gray-400 disabled:opacity-50 max-h-48 overflow-y-auto"
              />
              <button
                onClick={sendMessage}
                disabled={!input.trim() || streaming || !activeSession}
                className="absolute right-2.5 bottom-2.5 p-2 rounded-xl bg-[#DB0011] text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <p className="text-center text-xs text-gray-300 mt-2">
            Answers are AI-generated — always verify against official procedures.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ message, isStreaming }: { message: ChatMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold mt-0.5',
        isUser ? 'bg-gray-700' : 'bg-[#DB0011]'
      )}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Bubble */}
      <div className={cn('max-w-[78%] flex flex-col gap-1', isUser ? 'items-end' : 'items-start')}>
        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm',
          isUser
            ? 'bg-gray-900 text-white rounded-tr-sm'
            : 'bg-gray-50 border border-gray-100 text-gray-900 rounded-tl-sm'
        )}>
          {isUser ? (
            <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-ul:text-gray-700 prose-code:bg-gray-200 prose-code:text-gray-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm as any]}>
                {message.content || ' '}
              </ReactMarkdown>
              {isStreaming && (
                <span className="inline-block w-2 h-4 ml-0.5 bg-[#DB0011] animate-pulse rounded-sm align-middle" />
              )}
            </div>
          )}
        </div>
        <span className="text-xs text-gray-400 px-1">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </motion.div>
  );
}

// ── Welcome / empty states ────────────────────────────────────────────────────
function WelcomeScreen({ market, journey }: { market: string; journey: string }) {
  const suggestions = [
    'What are the KYC requirements for opening a commercial account?',
    'What documents are needed for a trade finance application?',
    'How do I process a change of authorized signatories?',
    'What is the process for account dormancy reactivation?',
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 gap-6">
      <div className="w-14 h-14 rounded-2xl bg-[#DB0011]/10 flex items-center justify-center">
        <Bot className="h-7 w-7 text-[#DB0011]" />
      </div>
      <div className="text-center">
        <h2 className="text-base font-semibold text-gray-900">Procedure Assistant</h2>
        <p className="text-sm text-gray-500 mt-1">
          {market && journey
            ? `Answering ${market} · ${journey} questions`
            : 'Set market & journey using the Context button above, then ask anything.'}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        {suggestions.map((s) => (
          <div key={s} className="px-4 py-3 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-600 cursor-default hover:bg-gray-100 transition-colors">
            {s}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-20 gap-4">
      <MessageSquare className="h-10 w-10 text-gray-200" />
      <p className="text-sm text-gray-500">Select a conversation or start a new one</p>
      <button
        onClick={onNew}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#DB0011] text-white text-sm font-medium hover:bg-red-700 transition-colors"
      >
        <Plus className="h-4 w-4" /> New Chat
      </button>
    </div>
  );
}
