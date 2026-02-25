'use client';

import { useEffect, useState } from 'react';

type ModelOption = { id: string; name: string; providerKey: string };

export default function HeartbeatPage() {
    const [model, setModel] = useState<string | null>(null);
    const [models, setModels] = useState<ModelOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedId, setSelectedId] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    const fetchHeartbeat = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/openclaw/heartbeat');
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setModel(data.model ?? null);
                setSelectedId(data.model ?? '');
                setModels((data.models ?? []).map((m: { id: string; name: string; providerKey: string }) => ({
                    id: m.id,
                    name: m.name ?? m.id,
                    providerKey: m.providerKey ?? m.id.split('/')[0],
                })));
            } else {
                setError(data.error ?? 'Failed to load heartbeat config');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHeartbeat();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch('/api/openclaw/heartbeat', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: selectedId || null }),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setModel(data.model ?? null);
                setSelectedId(data.model ?? '');
            } else {
                setError(data.error ?? 'Failed to save');
            }
        } finally {
            setSaving(false);
        }
    };

    const hasChange = selectedId !== (model ?? '');

    if (loading) {
        return (
            <div className="page">
                <div className="page-header">
                    <div>
                        <h1 className="page-title">Heartbeat</h1>
                        <p className="page-subtitle">Loading…</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Heartbeat</h1>
                    <p className="page-subtitle">
                        Configure which model runs periodic heartbeat checks for the entire OpenClaw system
                    </p>
                </div>
            </div>

            <div style={{ maxWidth: 420 }}>
                <div className="form-group" style={{ marginBottom: 12 }}>
                    <label className="form-label" htmlFor="heartbeat-model">
                        Heartbeat model
                    </label>
                    <select
                        id="heartbeat-model"
                        className="form-select"
                        value={selectedId}
                        onChange={(e) => setSelectedId(e.target.value)}
                    >
                        <option value="">Use default (agent default)</option>
                        {models.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name} ({m.providerKey})
                            </option>
                        ))}
                    </select>
                    <p className="form-hint" style={{ marginTop: 8 }}>
                        When set, all heartbeat runs use this model. When unset, each agent uses its own default model.
                    </p>
                </div>

                {error && (
                    <div className="form-error" style={{ marginBottom: 12 }}>
                        {error}
                    </div>
                )}

                <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={saving || !hasChange}
                >
                    {saving ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
}
