'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AddModelModal } from '@/components/AddModelModal';
import { useAlertConfirm } from '@/components/AlertConfirmProvider';

type ModelRow = {
    id: string;
    providerKey: string;
    name: string;
    contextWindow?: number;
    maxTokens?: number;
    platformUrl: string | null;
};

type AvailableToAdd = { providerKey: string; models: { id: string; fullId: string; name: string }[] }[];

export default function ModelsPage() {
    const [models, setModels] = useState<ModelRow[]>([]);
    const [availableToAdd, setAvailableToAdd] = useState<AvailableToAdd>([]);
    const [loading, setLoading] = useState(true);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const router = useRouter();
    const { showAlert, confirmDialog } = useAlertConfirm();

    const fetchModels = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/openclaw/models');
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                setModels(data.models ?? []);
                setAvailableToAdd(data.availableToAdd ?? []);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchModels();
    }, []);

    const handleDelete = async (modelId: string) => {
        if (!(await confirmDialog({ message: `Remove "${modelId}" from available models? Agents using it will be reassigned to another model.`, confirmLabel: 'Remove' }))) return;
        setDeletingId(modelId);
        try {
            const res = await fetch(`/api/openclaw/model/${encodeURIComponent(modelId)}`, { method: 'DELETE' });
            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                router.refresh();
                await fetchModels();
            } else {
                showAlert(data.error || 'Failed to remove model');
            }
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Models</h1>
                    <p className="page-subtitle">
                        Configure and monitor your API models
                    </p>
                </div>
                <div className="header-actions">
                    <AddModelModal availableToAdd={availableToAdd} onAdded={fetchModels} />
                </div>
            </div>

            {loading ? (
                <div className="empty-state">
                    <p>Loading models…</p>
                </div>
            ) : models.length === 0 ? (
                <div className="empty-state">
                    <p>No models configured yet. Use &quot;Add model&quot; above to add one from an existing provider or set up a new one.</p>
                </div>
            ) : (
                <div className="models-table-wrap">
                    <table className="models-table">
                        <thead>
                            <tr>
                                <th>Model</th>
                                <th>Provider</th>
                                <th>Usage & platform</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {models.map((m) => (
                                <tr key={m.id}>
                                    <td>
                                        <div className="model-name-cell">{m.name}</div>
                                        <div className="model-id-cell">{m.id}</div>
                                    </td>
                                    <td>
                                        <span className="provider-badge">{m.providerKey}</span>
                                    </td>
                                    <td>
                                        {m.platformUrl ? (
                                            <a
                                                href={m.platformUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="model-link-btn"
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                                    <polyline points="15 3 21 3 21 9" />
                                                    <line x1="10" y1="14" x2="21" y2="3" />
                                                </svg>
                                                View usage & billing
                                            </a>
                                        ) : (
                                            <span className="form-muted" style={{ margin: 0 }}>Local / custom</span>
                                        )}
                                    </td>
                                    <td>
                                        <div className="model-actions-cell">
                                            <button
                                                type="button"
                                                className="model-delete-btn"
                                                onClick={() => handleDelete(m.id)}
                                                disabled={deletingId !== null || models.length <= 1}
                                                title="Remove from available models"
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6" />
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                    <line x1="10" y1="11" x2="10" y2="17" />
                                                    <line x1="14" y1="11" x2="14" y2="17" />
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
