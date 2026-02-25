'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { CreateAgentModal } from '@/components/CreateAgentModal';
import { useAlertConfirm } from '@/components/AlertConfirmProvider';
import type { Agent } from '@/lib/openclaw';

export type ChatMessage = { role: 'user' | 'assistant'; text: string; timestamp?: number };

function extractText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((c) => (c && typeof c === 'object' && 'text' in c && typeof (c as { text: string }).text === 'string' ? (c as { text: string }).text : (c && typeof c === 'object' && 'type' in c && (c as { type: string }).type === 'text' && 'text' in c ? String((c as { text: string }).text ?? '') : '')))
            .join('');
    }
    if (content && typeof content === 'object' && 'text' in content) return String((content as { text: string }).text ?? '');
    return '';
}

/** Extract displayable text from a gateway chat event message (delta or full message with content array). */
function extractMessageText(message: unknown): string {
    if (message == null) return '';
    if (typeof message === 'string') return message;
    const m = message as { content?: unknown; text?: string };
    if (m.content !== undefined) return extractText(m.content);
    if (typeof m.text === 'string') return m.text;
    return extractText(message);
}

function normalizeHistoryMessage(msg: unknown): ChatMessage | null {
    if (!msg || typeof msg !== 'object') return null;
    const m = msg as { role?: string; content?: unknown; message?: { role?: string; content?: unknown }; createdAt?: number };
    const inner = m.message && typeof m.message === 'object' ? m.message : m;
    const role = inner.role === 'user' || inner.role === 'assistant' ? inner.role : null;
    if (!role) return null;
    const text = extractText(inner.content);
    const ts = typeof (m as { createdAt?: number }).createdAt === 'number' ? (m as { createdAt?: number }).createdAt : undefined;
    return { role, text, timestamp: ts };
}

function formatMessageTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface ChatPanelProps {
    agents: Agent[];
    availableModels: string[];
    initialAgentId: string | null;
}

export function ChatPanel({ agents, availableModels, initialAgentId }: ChatPanelProps) {
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(() => {
        if (initialAgentId && agents.some((a) => a.id === initialAgentId)) return initialAgentId;
        return agents.length > 0 ? agents[0].id : null;
    });
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [gatewayError, setGatewayError] = useState<string | null>(null);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [clearingChat, setClearingChat] = useState(false);
    const [deletingChat, setDeletingChat] = useState(false);
    const [sessionKey, setSessionKey] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const streamingTextRef = useRef('');
    const { showAlert, confirmDialog } = useAlertConfirm();

    const agentId = selectedAgentId ?? (agents.length > 0 ? agents[0].id : null);

    const loadHistory = async (id: string) => {
        setLoadingHistory(true);
        setGatewayError(null);
        setHistoryError(null);
        try {
            const res = await fetch(`/api/openclaw/chat/history?agentId=${encodeURIComponent(id)}&limit=100`);
            if (res.status === 503) {
                setGatewayError('Gateway not available. Start OpenClaw gateway to chat.');
                setMessages([]);
                return;
            }
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                setHistoryError(errData?.error ?? 'Could not load history');
                setMessages([]);
                return;
            }
            const data = await res.json();
            const raw = data?.messages ?? [];
            setSessionKey(typeof data?.sessionKey === 'string' ? data.sessionKey : null);
            const list = raw.map(normalizeHistoryMessage).filter((m: ChatMessage | null): m is ChatMessage => m !== null);
            setMessages(list);
        } catch {
            setHistoryError('Could not load history');
            setSessionKey(null);
            setMessages([]);
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => {
        if (agentId) loadHistory(agentId);
    }, [agentId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const sendMessage = async () => {
        const text = input.trim();
        if (!text || !agentId || loading) return;
        setInput('');
        const now = Date.now();
        setMessages((prev) => [...prev, { role: 'user', text, timestamp: now }]);
        setLoading(true);
        setGatewayError(null);
        streamingTextRef.current = '';
        setMessages((prev) => [...prev, { role: 'assistant', text: '', timestamp: now }]);

        try {
            const res = await fetch('/api/openclaw/chat/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, message: text }),
            });
            if (res.status === 503) {
                setGatewayError('Gateway not available. Start OpenClaw gateway to chat.');
                setMessages((prev) => {
                    const next = [...prev];
                    const ts = next[next.length - 1]?.timestamp;
                    next[next.length - 1] = { role: 'assistant', text: 'Gateway not available.', timestamp: ts };
                    return next;
                });
                return;
            }
            if (!res.ok || !res.body) {
                setMessages((prev) => {
                    const next = [...prev];
                    const ts = next[next.length - 1]?.timestamp;
                    next[next.length - 1] = { role: 'assistant', text: 'Failed to send message.', timestamp: ts };
                    return next;
                });
                return;
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const payload = JSON.parse(line.slice(6)) as { state?: string; message?: unknown; errorMessage?: string };
                            if (payload.errorMessage) {
                                streamingTextRef.current += payload.errorMessage;
                            }
                            const msg = payload.message;
                            if (msg !== undefined && msg !== null) {
                                // Gateway sends full message content on each event; always replace to avoid duplicating text during stream
                                streamingTextRef.current = extractMessageText(msg);
                            }
                            setMessages((prev) => {
                                const next = [...prev];
                                const ts = next[next.length - 1]?.timestamp;
                                next[next.length - 1] = { role: 'assistant', text: streamingTextRef.current, timestamp: ts };
                                return next;
                            });
                        } catch {
                            // ignore parse errors
                        }
                    }
                }
            }
        } catch {
            setMessages((prev) => {
                const next = [...prev];
                const ts = next[next.length - 1]?.timestamp;
                next[next.length - 1] = { role: 'assistant', text: 'Network error.', timestamp: ts };
                return next;
            });
        } finally {
            setLoading(false);
        }
    };

    const handleCreateAgent = (id: string) => {
        setSelectedAgentId(id);
        setShowCreateModal(false);
        loadHistory(id);
    };

    const handleClearChat = async () => {
        if (!agentId) return;
        const ok = await confirmDialog({
            message: 'Are you sure you want to clear all messages in this chat? This cannot be undone.',
            confirmLabel: 'Clear chat',
            warning: true,
            cancelLabel: 'Cancel',
        });
        if (!ok) return;
        setClearingChat(true);
        try {
            const res = await fetch('/api/openclaw/chat/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, sessionKey }),
            });
            if (res.ok) {
                setMessages([]);
                setGatewayError(null);
                setHistoryError(null);
                await loadHistory(agentId);
            } else {
                const data = await res.json().catch(() => ({}));
                showAlert(data?.error ?? 'Failed to clear chat');
            }
        } catch {
            showAlert('Failed to clear chat');
        } finally {
            setClearingChat(false);
        }
    };

    const handleDeleteChat = async () => {
        if (!agentId) return;
        const ok = await confirmDialog({
            message: 'Delete this chat session? The session and all messages will be permanently removed. This cannot be undone.',
            confirmLabel: 'Delete chat',
            cancelLabel: 'Cancel',
            danger: true,
        });
        if (!ok) return;
        setDeletingChat(true);
        try {
            const res = await fetch('/api/openclaw/chat/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId, sessionKey }),
            });
            if (res.ok) {
                setMessages([]);
                setGatewayError(null);
                setHistoryError(null);
                setSessionKey(null);
                await loadHistory(agentId);
            } else {
                const data = await res.json().catch(() => ({}));
                showAlert(data?.error ?? 'Failed to delete chat');
            }
        } catch {
            showAlert('Failed to delete chat');
        } finally {
            setDeletingChat(false);
        }
    };

    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const copyMessage = useCallback(async (text: string, index: number) => {
        const fallbackCopy = () => {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
            } finally {
                document.body.removeChild(textarea);
            }
        };
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                fallbackCopy();
            }
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch {
            fallbackCopy();
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        }
    }, []);

    const currentAgent = agentId ? agents.find((a) => a.id === agentId) : undefined;
    const agentName = currentAgent?.name ?? agentId ?? 'Agent';
    const agentEmoji = currentAgent?.emoji;
    const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    const showTypingIndicator = Boolean(
        loading && lastMsg && lastMsg.role === 'assistant' && !lastMsg.text
    );

    if (agents.length === 0 && !showCreateModal) {
        return (
            <div className="page">
                <div className="page-header">
                    <h1 className="page-title">Chat</h1>
                    <p className="page-subtitle">No agents configured</p>
                </div>
                <div className="empty-state">
                    <p>Create an agent first from the Agents page, or use &quot;New agent&quot; below.</p>
                    <button type="button" className="btn-primary" onClick={() => setShowCreateModal(true)}>
                        New agent
                    </button>
                </div>
                <CreateAgentModal
                    availableModels={availableModels}
                    open={showCreateModal}
                    onOpenChange={setShowCreateModal}
                    onCreated={handleCreateAgent}
                />
            </div>
        );
    }

    return (
        <div className="page chat-page">
            <div className="page-header chat-header">
                <div>
                    <h1 className="page-title">Chat</h1>
                    <p className="page-subtitle">
                        {agentId ? `Chat with ${agents.find((a) => a.id === agentId)?.name ?? agentId}` : 'Select an agent'}
                    </p>
                </div>
                <div className="chat-agent-row">
                    <select
                        className="form-select chat-agent-select"
                        value={agentId ?? ''}
                        onChange={(e) => setSelectedAgentId(e.target.value || null)}
                        aria-label="Select agent"
                    >
                        {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.emoji ? `${a.emoji} ` : ''}{a.name}
                            </option>
                        ))}
                    </select>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn-outline"
                            onClick={() => setShowCreateModal(true)}
                        >
                            New agent
                        </button>
                        <button
                            type="button"
                            className="btn-warning chat-clear-btn"
                            onClick={handleClearChat}
                            disabled={!agentId || clearingChat || deletingChat || loading}
                            title="Clear all messages in this chat"
                            aria-label="Clear chat"
                        >
                            {clearingChat ? 'Clearing…' : 'Clear chat'}
                        </button>
                        <button
                            type="button"
                            className="btn-danger chat-delete-btn"
                            onClick={handleDeleteChat}
                            disabled={!agentId || clearingChat || deletingChat || loading}
                            title="Delete this chat session and all messages"
                            aria-label="Delete chat"
                        >
                            {deletingChat ? 'Deleting…' : 'Delete chat'}
                        </button>
                    </div>
                </div>
            </div>

            {(gatewayError || historyError) && (
                <div className="chat-gateway-error">
                    {gatewayError ?? historyError}
                </div>
            )}

            <div className="chat-messages-wrap">
                {loadingHistory ? (
                    <div className="chat-loading">Loading history…</div>
                ) : (
                    <div className="chat-messages">
                        {messages.length === 0 ? (
                            <div className="chat-empty-history">
                                <p>No messages in this session yet.</p>
                                <p className="chat-empty-hint">History comes from the same OpenClaw session (e.g. Main Session). Send a message below or use the gateway from the CLI to add more.</p>
                            </div>
                        ) : (
                            messages.map((msg, i) => {
                                const isLastAssistantEmpty = msg.role === 'assistant' && !msg.text && i === messages.length - 1 && showTypingIndicator;
                                return (
                                    <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                                        {msg.role === 'assistant' && (
                                            <span className="chat-msg-avatar" aria-hidden>
                                                {agentEmoji ?? 'A'}
                                            </span>
                                        )}
                                        <div className="chat-msg-bubble">
                                            <div className="chat-msg-meta">
                                                <span className="chat-msg-sender">{msg.role === 'user' ? 'You' : agentName}</span>
                                                {msg.timestamp != null && (
                                                    <span className="chat-msg-time">{formatMessageTime(msg.timestamp)}</span>
                                                )}
                                                {msg.role === 'user' && i === messages.length - 1 && loading && (
                                                    <span className="chat-msg-status">Sending…</span>
                                                )}
                                                {msg.text && (
                                                    <button
                                                        type="button"
                                                        className="chat-msg-copy"
                                                        onClick={() => copyMessage(msg.text, i)}
                                                        title="Copy message"
                                                        aria-label="Copy message"
                                                    >
                                                        {copiedIndex === i ? 'Copied!' : 'Copy'}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="chat-msg-content">
                                                {isLastAssistantEmpty ? (
                                                    <span className="chat-typing-indicator">
                                                        <span className="chat-typing-dot" />
                                                        <span className="chat-typing-dot" />
                                                        <span className="chat-typing-dot" />
                                                    </span>
                                                ) : msg.role === 'assistant' && msg.text ? (
                                                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                                                ) : (
                                                    msg.text || '\u200b'
                                                )}
                                            </div>
                                        </div>
                                        {msg.role === 'user' && (
                                            <span className="chat-msg-avatar chat-msg-avatar-user" aria-hidden>
                                                U
                                            </span>
                                        )}
                                    </div>
                                );
                            })
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            <div className="chat-input-wrap">
                <textarea
                    className="chat-input"
                    placeholder={agentId ? 'Message…' : 'Select an agent to chat'}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                        }
                    }}
                    disabled={!agentId || loading}
                    rows={2}
                    aria-label="Message"
                />
                <button
                    type="button"
                    className="btn-primary chat-send-btn"
                    onClick={sendMessage}
                    disabled={!agentId || loading || !input.trim()}
                >
                    {loading ? 'Sending…' : 'Send'}
                </button>
            </div>

            <CreateAgentModal
                availableModels={availableModels}
                open={showCreateModal}
                onOpenChange={setShowCreateModal}
                onCreated={handleCreateAgent}
            />
        </div>
    );
}
