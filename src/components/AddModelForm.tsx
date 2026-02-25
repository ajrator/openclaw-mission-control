'use client';

import { useState, useEffect } from 'react';

export type AvailableToAdd = { providerKey: string; models: { id: string; fullId: string; name: string }[] }[];

const API_TYPES = [
    'openai-completions',
    'openai-responses',
    'anthropic-messages',
    'google-generative-ai',
    'github-copilot',
    'bedrock-converse-stream',
    'ollama',
] as const;

const AUTH_MODES = [
    { value: 'api-key', label: 'API key', hint: 'Static key in config or env' },
    { value: 'oauth', label: 'OAuth', hint: 'Configure in agent auth profiles or openclaw configure' },
    { value: 'token', label: 'Token', hint: 'Bearer / PAT in auth profiles' },
    { value: 'aws-sdk', label: 'AWS SDK', hint: 'Uses AWS credentials (e.g. Bedrock)' },
] as const;

export function AddModelForm({
    availableToAdd,
    onSuccess,
    onCancel,
    backLabel = 'Cancel',
}: {
    availableToAdd: AvailableToAdd;
    onSuccess: (newModelId?: string) => void;
    onCancel: () => void;
    backLabel?: string;
}) {
    const [mode, setMode] = useState<'existing' | 'new'>('existing');
    const [selectedProviderKey, setSelectedProviderKey] = useState('');
    const [selectedModelId, setSelectedModelId] = useState('');
    const [providerKey, setProviderKey] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [api, setApi] = useState<string>('openai-completions');
    const [auth, setAuth] = useState<string>('api-key');
    const [authHeader, setAuthHeader] = useState(true);
    const [headersJson, setHeadersJson] = useState('');
    const [modelId, setModelId] = useState('');
    const [modelName, setModelName] = useState('');
    const [reasoning, setReasoning] = useState(false);
    const [inputText, setInputText] = useState(true);
    const [inputImage, setInputImage] = useState(false);
    const [contextWindow, setContextWindow] = useState('128000');
    const [maxTokens, setMaxTokens] = useState('4096');
    const [costInput, setCostInput] = useState('0');
    const [costOutput, setCostOutput] = useState('0');
    const [costCacheRead, setCostCacheRead] = useState('0');
    const [costCacheWrite, setCostCacheWrite] = useState('0');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const selectedProvider = availableToAdd.find((p) => p.providerKey === selectedProviderKey);
    const availableModels = selectedProvider?.models ?? [];

    const resetForm = () => {
        setError(null);
        setMode('existing');
        setSelectedProviderKey(availableToAdd[0]?.providerKey ?? '');
        setSelectedModelId('');
        setProviderKey('');
        setBaseUrl('');
        setApiKey('');
        setApi('openai-completions');
        setAuth('api-key');
        setAuthHeader(true);
        setHeadersJson('');
        setModelId('');
        setModelName('');
        setReasoning(false);
        setInputText(true);
        setInputImage(false);
        setContextWindow('128000');
        setMaxTokens('4096');
        setCostInput('0');
        setCostOutput('0');
        setCostCacheRead('0');
        setCostCacheWrite('0');
    };

    useEffect(() => {
        resetForm();
    }, [availableToAdd]);

    const handleSubmitExisting = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedModelId) return;
        setError(null);
        setIsSaving(true);
        try {
            const res = await fetch('/api/openclaw/model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelId: selectedModelId }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                onSuccess(data.modelId);
            } else {
                setError(data.error || 'Failed to add model');
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleSubmitNew = async (e: React.FormEvent) => {
        e.preventDefault();
        const key = providerKey.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        if (!key || !modelId.trim() || !modelName.trim()) {
            setError('Provider key, model ID, and name are required');
            return;
        }
        let headers: Record<string, string> | undefined;
        if (headersJson.trim()) {
            try {
                const parsed = JSON.parse(headersJson.trim());
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    headers = {};
                    for (const [k, v] of Object.entries(parsed)) {
                        if (typeof k === 'string' && typeof v === 'string') headers[k] = v;
                    }
                }
            } catch {
                setError('Custom headers must be valid JSON object (e.g. {"X-Custom": "value"})');
                return;
            }
        }
        const input: Array<'text' | 'image'> = [];
        if (inputText) input.push('text');
        if (inputImage) input.push('image');
        if (input.length === 0) input.push('text');

        setError(null);
        setIsSaving(true);
        try {
            const res = await fetch('/api/openclaw/model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerKey: key,
                    baseUrl: baseUrl.trim() || undefined,
                    apiKey: apiKey.trim() || undefined,
                    api,
                    auth: auth || undefined,
                    authHeader,
                    headers,
                    model: {
                        id: modelId.trim(),
                        name: modelName.trim(),
                        reasoning,
                        input,
                        contextWindow: Number(contextWindow) || 128000,
                        maxTokens: Number(maxTokens) || 4096,
                        cost: {
                            input: Number(costInput) || 0,
                            output: Number(costOutput) || 0,
                            cacheRead: Number(costCacheRead) || 0,
                            cacheWrite: Number(costCacheWrite) || 0,
                        },
                    },
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                onSuccess(data.modelId);
            } else {
                setError(data.error || 'Failed to add model');
            }
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="modal-body">
            <div className="form-group">
                <span className="form-label">Source</span>
                <div className="model-source-tabs">
                    <button
                        type="button"
                        className={`model-source-tab ${mode === 'existing' ? 'active' : ''}`}
                        onClick={() => setMode('existing')}
                    >
                        From existing provider
                    </button>
                    <button
                        type="button"
                        className={`model-source-tab ${mode === 'new' ? 'active' : ''}`}
                        onClick={() => setMode('new')}
                    >
                        New provider / model
                    </button>
                </div>
            </div>

            {error && (
                <div className="form-error" role="alert">
                    {error}
                </div>
            )}

            {mode === 'existing' && (
                <form onSubmit={handleSubmitExisting}>
                    {availableToAdd.length === 0 ? (
                        <>
                            <p className="form-muted">All provider models are already in your list. Add a new provider and model below.</p>
                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={onCancel}>
                                    {backLabel}
                                </button>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="form-group">
                                <label className="form-label">Provider</label>
                                <select
                                    className="form-select"
                                    value={selectedProviderKey}
                                    onChange={(e) => {
                                        setSelectedProviderKey(e.target.value);
                                        setSelectedModelId('');
                                    }}
                                >
                                    {availableToAdd.map((p) => (
                                        <option key={p.providerKey} value={p.providerKey}>
                                            {p.providerKey}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Model</label>
                                <select
                                    className="form-select"
                                    value={selectedModelId}
                                    onChange={(e) => setSelectedModelId(e.target.value)}
                                    required
                                >
                                    <option value="">Select a model</option>
                                    {availableModels.map((m) => (
                                        <option key={m.fullId} value={m.fullId}>
                                            {m.name} ({m.fullId})
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn-secondary" onClick={onCancel}>
                                    {backLabel}
                                </button>
                                <button type="submit" className="btn-primary" disabled={isSaving || !selectedModelId}>
                                    {isSaving ? 'Adding...' : 'Add to list'}
                                </button>
                            </div>
                        </>
                    )}
                </form>
            )}

            {mode === 'new' && (
                <form onSubmit={handleSubmitNew}>
                    <div className="form-group">
                        <label className="form-label">Provider key (slug)</label>
                        <input
                            className="form-input"
                            type="text"
                            placeholder="e.g. my-openai"
                            value={providerKey}
                            onChange={(e) => setProviderKey(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Base URL (optional)</label>
                        <input
                            className="form-input"
                            type="url"
                            placeholder="https://api.openai.com/v1"
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">API key (optional)</label>
                        <input
                            className="form-input"
                            type="password"
                            placeholder="sk-..."
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            autoComplete="off"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">API type</label>
                        <select className="form-select" value={api} onChange={(e) => setApi(e.target.value)}>
                            {API_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Auth mode</label>
                        <select className="form-select" value={auth} onChange={(e) => setAuth(e.target.value)}>
                            {AUTH_MODES.map((m) => (
                                <option key={m.value} value={m.value}>
                                    {m.label} — {m.hint}
                                </option>
                            ))}
                        </select>
                        {auth === 'oauth' && (
                            <p className="form-hint">Use <code>openclaw configure</code> or agent auth profiles to set up OAuth credentials.</p>
                        )}
                    </div>
                    <div className="form-group form-group-checkbox">
                        <label className="form-label form-label-inline">
                            <input type="checkbox" checked={authHeader} onChange={(e) => setAuthHeader(e.target.checked)} />
                            <span>Send API key in header</span>
                        </label>
                        <span className="form-hint">When enabled, key is sent as Authorization / API-Key header.</span>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Custom headers (optional JSON)</label>
                        <textarea
                            className="form-input form-textarea"
                            placeholder='{"X-Custom-Header": "value"}'
                            value={headersJson}
                            onChange={(e) => setHeadersJson(e.target.value)}
                            rows={2}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Model ID</label>
                        <input
                            className="form-input"
                            type="text"
                            placeholder="e.g. gpt-4o"
                            value={modelId}
                            onChange={(e) => setModelId(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Display name</label>
                        <input
                            className="form-input"
                            type="text"
                            placeholder="e.g. GPT-4o"
                            value={modelName}
                            onChange={(e) => setModelName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="form-group form-group-checkbox">
                        <label className="form-label form-label-inline">
                            <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} />
                            <span>Reasoning / extended thinking</span>
                        </label>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Input modalities</label>
                        <div className="form-checkbox-group">
                            <label className="form-label-inline">
                                <input type="checkbox" checked={inputText} onChange={(e) => setInputText(e.target.checked)} />
                                <span>Text</span>
                            </label>
                            <label className="form-label-inline">
                                <input type="checkbox" checked={inputImage} onChange={(e) => setInputImage(e.target.checked)} />
                                <span>Image</span>
                            </label>
                        </div>
                    </div>
                    <div className="form-row two-cols">
                        <div className="form-group">
                            <label className="form-label">Context window</label>
                            <input className="form-input" type="number" min="1" value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Max tokens</label>
                            <input className="form-input" type="number" min="1" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
                        </div>
                    </div>
                    <div className="form-row two-cols">
                        <div className="form-group">
                            <label className="form-label">Cost input (per 1M)</label>
                            <input className="form-input" type="number" min="0" step="0.01" value={costInput} onChange={(e) => setCostInput(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Cost output (per 1M)</label>
                            <input className="form-input" type="number" min="0" step="0.01" value={costOutput} onChange={(e) => setCostOutput(e.target.value)} />
                        </div>
                    </div>
                    <div className="form-row two-cols">
                        <div className="form-group">
                            <label className="form-label">Cost cache read (per 1M)</label>
                            <input className="form-input" type="number" min="0" step="0.01" value={costCacheRead} onChange={(e) => setCostCacheRead(e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Cost cache write (per 1M)</label>
                            <input className="form-input" type="number" min="0" step="0.01" value={costCacheWrite} onChange={(e) => setCostCacheWrite(e.target.value)} />
                        </div>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn-secondary" onClick={onCancel}>
                            {backLabel}
                        </button>
                        <button type="submit" className="btn-primary" disabled={isSaving || !providerKey.trim() || !modelId.trim() || !modelName.trim()}>
                            {isSaving ? 'Adding...' : 'Add provider & model'}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
