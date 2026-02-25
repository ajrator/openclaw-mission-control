"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Agent } from '@/lib/openclaw';
import { sanitizeAgentFallbacks } from '@/lib/agent-models';
import { useAlertConfirm } from '@/components/AlertConfirmProvider';

const MAIN_AGENT_ID = 'main';

interface AgentCardProps {
    agent: Agent;
}

const sourceColors: Record<string, string> = {
    'openclaw-bundled': 'badge-bundled',
    'openclaw-workspace': 'badge-workspace',
};

export function AgentCard({ agent }: AgentCardProps) {
    const latestSession = agent.sessions[0];
    const skills = latestSession?.skills ?? [];

    const primary = agent.configuredModel || '';
    const [selectedModel, setSelectedModel] = useState(primary);
    const [fallbacksList, setFallbacksList] = useState<string[]>(sanitizeAgentFallbacks(primary, agent.fallbacks ?? []));
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingFallbacks, setIsSavingFallbacks] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const router = useRouter();
    const { showAlert, confirmDialog } = useAlertConfirm();
    const canDelete = agent.id !== MAIN_AGENT_ID;

    const isDirty = selectedModel !== primary;
    const fallbacksDirty =
        (agent.fallbacks?.length ?? 0) !== fallbacksList.length ||
        (agent.fallbacks ?? []).some((f, i) => f !== fallbacksList[i]);
    const remainingModels =
        (agent.availableModels ?? []).filter(
            (m) => m !== selectedModel && !fallbacksList.includes(m)
        );
    const primaryOptions =
        (agent.availableModels ?? []).filter((m) => m === selectedModel || !fallbacksList.includes(m));

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const res = await fetch('/api/openclaw/model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId: agent.id, model: selectedModel })
            });
            if (res.ok) {
                router.refresh();
            }
        } finally {
            setIsSaving(false);
        }
    };

    const saveFallbacks = async () => {
        if (!fallbacksDirty) return;
        setIsSavingFallbacks(true);
        try {
            const res = await fetch('/api/openclaw/model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    agentId: agent.id,
                    model: selectedModel,
                    fallbacks: sanitizeAgentFallbacks(selectedModel, fallbacksList)
                })
            });
            if (res.ok) router.refresh();
        } finally {
            setIsSavingFallbacks(false);
        }
    };

    const moveFallback = (index: number, dir: -1 | 1) => {
        const next = [...fallbacksList];
        const j = index + dir;
        if (j < 0 || j >= next.length) return;
        [next[index], next[j]] = [next[j], next[index]];
        setFallbacksList(next);
    };

    const removeFallback = (index: number) => {
        setFallbacksList(fallbacksList.filter((_, i) => i !== index));
    };

    const addFallback = (model: string) => {
        setFallbacksList((prev) => sanitizeAgentFallbacks(selectedModel, [...prev, model]));
    };

    const handleDelete = async () => {
        if (!canDelete || !(await confirmDialog({ message: `Delete agent "${agent.name}"? This cannot be undone.`, confirmLabel: 'Delete' }))) return;
        setIsDeleting(true);
        try {
            const res = await fetch(`/api/openclaw/agent/${encodeURIComponent(agent.id)}`, { method: 'DELETE' });
            if (res.ok) {
                router.refresh();
            } else {
                const data = await res.json().catch(() => ({}));
                showAlert(data.error || 'Failed to delete agent');
            }
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <div className="agent-card">
            <div className="agent-card-header">
                <div className="agent-avatar">
                    {agent.emoji ? (
                        <span className="agent-emoji">{agent.emoji}</span>
                    ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="2" y="3" width="20" height="14" rx="2" />
                            <path d="M8 21h8M12 17v4" />
                        </svg>
                    )}
                </div>
                <div className="agent-meta">
                    <h2 className="agent-name">{agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}</h2>
                    <div className="agent-stats">
                        <div className="agent-stat">
                            {latestSession && <span className="stat-dot active" />}
                            {agent.availableModels && agent.availableModels.length > 0 ? (
                                <div className="model-selector-group">
                                    <select
                                        className="model-select"
                                        value={selectedModel}
                                        onChange={(e) => {
                                            const nextPrimary = e.target.value;
                                            setSelectedModel(nextPrimary);
                                            setFallbacksList((prev) => sanitizeAgentFallbacks(nextPrimary, prev));
                                        }}
                                        disabled={isSaving}
                                    >
                                        {primaryOptions.map(m => (
                                            <option key={m} value={m}>{m}</option>
                                        ))}
                                    </select>
                                    {isDirty && (
                                        <button className="btn-save-model" onClick={handleSave} disabled={isSaving}>
                                            {isSaving ? 'Sav...' : 'Save'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <span>{primary || (latestSession?.model ?? '—')}</span>
                            )}
                        </div>
                        <span className="agent-stat-sep">·</span>
                        <span className="agent-stat">{skills.length} skills</span>
                    </div>
                </div>
                {canDelete && (
                    <button
                        type="button"
                        className="agent-delete-btn"
                        onClick={handleDelete}
                        disabled={isDeleting}
                        title={`Delete ${agent.name}`}
                        aria-label={`Delete ${agent.name}`}
                    >
                        {isDeleting ? (
                            <span className="agent-delete-label">Deleting…</span>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                            </svg>
                        )}
                    </button>
                )}
            </div>

            {(agent.availableModels?.length ?? 0) > 0 && (
                <div className="fallbacks-section">
                    <div className="fallbacks-section-header">
                        <span className="fallbacks-section-title">Fallback models</span>
                        {fallbacksDirty && (
                            <button
                                type="button"
                                className="btn-save-fallbacks"
                                onClick={saveFallbacks}
                                disabled={isSavingFallbacks}
                            >
                                {isSavingFallbacks ? 'Saving…' : 'Save order'}
                            </button>
                        )}
                    </div>
                    <div className="fallbacks-list">
                        {fallbacksList.map((modelId, index) => (
                            <div key={`${modelId}-${index}`} className="fallback-row">
                                <span className="fallback-model-name">{modelId}</span>
                                <div className="fallback-actions">
                                    <button
                                        type="button"
                                        className="fallback-move-btn"
                                        onClick={() => moveFallback(index, -1)}
                                        disabled={index === 0}
                                        title="Move up"
                                        aria-label="Move up"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 15l-6-6-6 6" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        className="fallback-move-btn"
                                        onClick={() => moveFallback(index, 1)}
                                        disabled={index === fallbacksList.length - 1}
                                        title="Move down"
                                        aria-label="Move down"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M6 9l6 6 6-6" />
                                        </svg>
                                    </button>
                                    <button
                                        type="button"
                                        className="fallback-remove-btn"
                                        onClick={() => removeFallback(index)}
                                        title="Remove"
                                        aria-label={`Remove ${modelId}`}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 6L6 18M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                    {remainingModels.length > 0 && (
                        <div className="fallbacks-add">
                            <select
                                className="fallbacks-add-select"
                                value=""
                                onChange={(e) => {
                                    const v = e.target.value;
                                    if (v) {
                                        addFallback(v);
                                        e.target.value = '';
                                    }
                                }}
                                aria-label="Add fallback model"
                            >
                                <option value="">Add fallback…</option>
                                {remainingModels.map((m) => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                    )}
                    {fallbacksList.length === 0 && remainingModels.length === 0 && (
                        <p className="fallbacks-empty-hint">Primary model only. Add more models in config to set fallbacks.</p>
                    )}
                </div>
            )}

            <details className="skills-section">
                <summary className="skills-header skills-summary">
                    <span className="skills-title">Installed Skills</span>
                    <span className="skills-summary-right">
                        <span className="skills-count">{skills.length}</span>
                        <span className="details-chevron" aria-hidden>▾</span>
                    </span>
                </summary>
                <div className="skills-list">
                    {skills.map((skill) => (
                        <div key={skill.name} className="skill-item">
                            <div className="skill-item-top">
                                <span className="skill-name">{skill.name}</span>
                                <span className={`skill-badge ${sourceColors[skill.source] ?? 'badge-workspace'}`}>
                                    {skill.source === 'openclaw-bundled' ? 'built-in' : 'workspace'}
                                </span>
                            </div>
                            <p className="skill-description">{skill.description}</p>
                        </div>
                    ))}
                </div>
            </details>
        </div>
    );
}
