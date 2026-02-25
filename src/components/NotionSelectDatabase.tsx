'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface DatabaseOption {
    id: string;
    title: string;
}

type Props = { returnTo?: string };

export function NotionSelectDatabase({ returnTo = '/tasks' }: Props) {
    const router = useRouter();
    const [databases, setDatabases] = useState<DatabaseOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectingId, setSelectingId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch('/api/notion/oauth/databases');
                const data = await res.json();
                if (cancelled) return;
                if (!res.ok) {
                    setError(data.error || 'Failed to load databases');
                    setDatabases([]);
                    return;
                }
                setDatabases(data.databases ?? []);
                setError(null);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : 'Failed to load databases');
                    setDatabases([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const handleSelect = async (databaseId: string) => {
        setSelectingId(databaseId);
        try {
            const res = await fetch('/api/notion/oauth/select', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ databaseId }),
            });
            if (res.ok) {
                router.push(returnTo);
                router.refresh();
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Failed to set database');
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to set database');
        } finally {
            setSelectingId(null);
        }
    };

    if (loading) {
        return (
            <div className="notion-select-database">
                <p className="page-subtitle">Loading your Notion databases…</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="notion-select-database">
                <p className="empty-state-title" style={{ color: 'var(--red, #ef4444)' }}>{error}</p>
                <p className="page-subtitle" style={{ marginTop: 8 }}>
                    You can <a href={returnTo}>go back</a> and try connecting again.
                </p>
            </div>
        );
    }

    if (databases.length === 0) {
        return (
            <div className="notion-select-database">
                <p className="empty-state-title">No databases found</p>
                <p className="page-subtitle" style={{ marginTop: 8, maxWidth: 420 }}>
                    Make sure you shared at least one database with the integration when you authorized. Go back and try again, or pick pages/databases in the Notion OAuth step.
                </p>
                <a href={returnTo} className="btn-secondary" style={{ marginTop: 16, display: 'inline-block' }}>
                    Go back
                </a>
            </div>
        );
    }

    return (
        <div className="notion-select-database">
            <p className="empty-state-title">Choose a database for Tasks</p>
            <p className="page-subtitle" style={{ marginTop: 4, marginBottom: 16 }}>
                This database will be used for your task board (tasks with an Agent set).
            </p>
            <ul className="notion-database-list">
                {databases.map((db) => (
                    <li key={db.id}>
                        <button
                            type="button"
                            className="notion-database-item"
                            onClick={() => handleSelect(db.id)}
                            disabled={selectingId !== null}
                        >
                            <span className="notion-database-title">{db.title || 'Untitled'}</span>
                            {selectingId === db.id ? (
                                <span className="notion-database-loading">Setting…</span>
                            ) : (
                                <span className="notion-database-select">Use this database</span>
                            )}
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
