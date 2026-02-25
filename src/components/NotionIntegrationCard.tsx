'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Props = {
    connected: boolean;
    canDisconnect: boolean;
    canConnect: boolean;
    workspaceName?: string | null;
    /** When true, show setup dialog on mount (e.g. after redirect from authorize with ?notion=setup_required) */
    showSetupOnMount?: boolean;
    /** When true, Tasks board includes Notion tasks. Only relevant when connected. */
    notionTasksEnabled?: boolean;
    /** Path to redirect to after OAuth (e.g. /onboarding/connect-notion). Default /integrations */
    returnTo?: string;
};

type SchemaFieldHealth = {
    key: string;
    required: boolean;
    status: 'present' | 'missing' | 'incompatible';
    foundKey?: string;
    foundType?: string;
    expected: string[];
};

type SchemaHealth = {
    ok: boolean;
    summary: { present: number; missing: number; incompatible: number };
    fields: SchemaFieldHealth[];
};

const NOTION_INTEGRATIONS_URL = 'https://www.notion.so/my-integrations';

const DEFAULT_RETURN_TO = '/integrations';

export function NotionIntegrationCard({ connected, canDisconnect, canConnect, workspaceName, showSetupOnMount, notionTasksEnabled = true, returnTo = DEFAULT_RETURN_TO }: Props) {
    const router = useRouter();
    const [disconnecting, setDisconnecting] = useState(false);
    const [togglingTasks, setTogglingTasks] = useState(false);
    const [schemaHealth, setSchemaHealth] = useState<SchemaHealth | null>(null);
    const [schemaHealthLoading, setSchemaHealthLoading] = useState(false);
    const [schemaRepairing, setSchemaRepairing] = useState(false);
    const [schemaHealthError, setSchemaHealthError] = useState<string | null>(null);
    const setupDialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (showSetupOnMount && setupDialogRef.current) {
            setupDialogRef.current.showModal();
        }
    }, [showSetupOnMount]);

    useEffect(() => {
        if (!connected || !notionTasksEnabled) return;
        let cancelled = false;
        const load = async () => {
            setSchemaHealthLoading(true);
            setSchemaHealthError(null);
            try {
                const res = await fetch('/api/notion/schema-health');
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Failed to load Notion schema health');
                if (!cancelled) setSchemaHealth(data as SchemaHealth);
            } catch (e) {
                if (!cancelled) setSchemaHealthError(e instanceof Error ? e.message : 'Failed to load Notion schema health');
            } finally {
                if (!cancelled) setSchemaHealthLoading(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [connected, notionTasksEnabled]);

    const handleDisconnect = async () => {
        if (!canDisconnect || disconnecting) return;
        setDisconnecting(true);
        try {
            const res = await fetch('/api/notion/oauth/disconnect', { method: 'POST' });
            if (res.ok) router.refresh();
        } finally {
            setDisconnecting(false);
        }
    };

    const handleNotionTasksToggle = async () => {
        if (togglingTasks) return;
        setTogglingTasks(true);
        try {
            const res = await fetch('/api/settings/notion-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: !notionTasksEnabled }),
            });
            if (res.ok) router.refresh();
        } finally {
            setTogglingTasks(false);
        }
    };

    const refreshSchemaHealth = async () => {
        setSchemaHealthLoading(true);
        setSchemaHealthError(null);
        try {
            const res = await fetch('/api/notion/schema-health');
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to load Notion schema health');
            setSchemaHealth(data as SchemaHealth);
        } catch (e) {
            setSchemaHealthError(e instanceof Error ? e.message : 'Failed to load Notion schema health');
        } finally {
            setSchemaHealthLoading(false);
        }
    };

    const repairSchema = async () => {
        if (schemaRepairing) return;
        setSchemaRepairing(true);
        setSchemaHealthError(null);
        try {
            const res = await fetch('/api/notion/schema-health', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to repair Notion schema');
            setSchemaHealth((data.health ?? null) as SchemaHealth | null);
            router.refresh();
        } catch (e) {
            setSchemaHealthError(e instanceof Error ? e.message : 'Failed to repair Notion schema');
        } finally {
            setSchemaRepairing(false);
        }
    };

    return (
        <div className="integration-card">
            <div className="integration-card-header">
                <img
                    src="/images/notion-favicon.ico"
                    alt=""
                    className="integration-card-icon"
                    width={28}
                    height={28}
                />
                <div className="integration-card-title-row">
                    <h3 className="integration-card-name">Notion</h3>
                    <span className={`integration-card-badge ${connected ? 'connected' : 'disconnected'}`}>
                        {connected ? 'Connected' : 'Not connected'}
                    </span>
                </div>
            </div>
            {connected && workspaceName && (
                <p className="integration-card-meta">Workspace: {workspaceName}</p>
            )}
            <p className="integration-card-desc">
                Notion is optional. You can use tasks with or without connecting Notion. Sync tasks with a Notion database and use the Tasks board to create, update, or archive tasks in Notion.
            </p>
            {connected && (
                <div className="integration-card-toggle-row">
                    <label className="integration-card-toggle-label">
                        <span>Use Notion for tasks</span>
                        <input
                            type="checkbox"
                            checked={notionTasksEnabled}
                            onChange={handleNotionTasksToggle}
                            disabled={togglingTasks}
                            aria-label="Use Notion for tasks"
                        />
                    </label>
                    <p className="integration-card-hint" style={{ marginTop: 4 }}>
                        Turn off to use local tasks only on the Tasks board.
                    </p>
                </div>
            )}
            {connected && notionTasksEnabled && (
                <details className="integration-card-schema-health">
                    <summary className="integration-card-schema-health-header integration-card-schema-summary-toggle">
                        <div>
                            <p className="integration-card-schema-title">Tasks schema health</p>
                            <p className="integration-card-hint" style={{ marginTop: 2 }}>
                                Checks the selected Notion database fields used by the Tasks board.
                            </p>
                        </div>
                        <div className="integration-card-schema-summary-right">
                            {schemaHealth && (
                                <span className={`integration-card-badge ${schemaHealth.ok ? 'connected' : 'disconnected'}`}>
                                    {schemaHealth.ok ? 'Ready' : 'Needs attention'}
                                </span>
                            )}
                            <span className="details-chevron" aria-hidden>▾</span>
                        </div>
                    </summary>

                    <div className="integration-card-schema-actions">
                        <button type="button" className="btn-secondary btn-sm" onClick={refreshSchemaHealth} disabled={schemaHealthLoading || schemaRepairing}>
                            {schemaHealthLoading ? 'Checking…' : 'Check'}
                        </button>
                        <button type="button" className="btn-secondary btn-sm" onClick={repairSchema} disabled={schemaRepairing || schemaHealthLoading}>
                            {schemaRepairing ? 'Repairing…' : 'Repair missing fields'}
                        </button>
                    </div>

                    {schemaHealthError && (
                        <p className="integration-card-hint" style={{ color: 'var(--color-danger, #dc2626)' }}>
                            {schemaHealthError}
                        </p>
                    )}

                    {schemaHealth && (
                        <>
                            <div className="integration-card-schema-summary">
                                <span className="integration-card-hint" style={{ marginTop: 0 }}>
                                    {schemaHealth.summary.present} present · {schemaHealth.summary.missing} missing · {schemaHealth.summary.incompatible} incompatible
                                </span>
                            </div>
                            <ul className="integration-card-schema-list">
                                {schemaHealth.fields.map((field) => (
                                    <li key={field.key} className="integration-card-schema-item">
                                        <span className="integration-card-schema-item-name">
                                            {field.key}
                                            {!field.required ? <span className="integration-card-schema-optional"> (optional)</span> : null}
                                        </span>
                                        <span className={`integration-card-schema-status status-${field.status}`}>
                                            {field.status}
                                        </span>
                                        {(field.status !== 'present' || field.foundKey) && (
                                            <div className="integration-card-schema-item-detail">
                                                {field.foundKey ? <>Found: <code>{field.foundKey}</code>{field.foundType ? ` (${field.foundType})` : ''}. </> : null}
                                                Expected: {field.expected.join(' or ')}
                                            </div>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </details>
            )}
            <div className="integration-card-actions">
                {connected && canDisconnect && (
                    <button
                        type="button"
                        className="btn-secondary"
                        onClick={handleDisconnect}
                        disabled={disconnecting}
                    >
                        {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                )}
                {connected && !canDisconnect && (
                    <p className="integration-card-hint">
                        Configured via environment variables. To disconnect, remove <code>NOTION_API_KEY</code> and <code>NOTION_TASKS_DATABASE_ID</code> from .env.local.
                    </p>
                )}
                {!connected && (
                    <>
                        <a href={`/api/notion/oauth/authorize?return_to=${encodeURIComponent(returnTo)}`} className="btn-primary">
                            Connect with Notion
                        </a>
                        {!canConnect && (
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setupDialogRef.current?.showModal()}
                            >
                                Setup instructions
                            </button>
                        )}
                        <dialog
                            ref={setupDialogRef}
                            className="integration-setup-dialog"
                            onClose={() => {}}
                            onClick={(e) => e.target === setupDialogRef.current && setupDialogRef.current?.close()}
                        >
                            <div className="integration-setup-dialog-inner" onClick={(e) => e.stopPropagation()}>
                                <h3 className="integration-setup-dialog-title">Set up Notion connection</h3>
                                <ol className="integration-setup-dialog-steps">
                                    <li>
                                        <a href={NOTION_INTEGRATIONS_URL} target="_blank" rel="noopener noreferrer">
                                            Open Notion integrations
                                        </a>
                                        {' '}and create a new integration (or use an existing one).
                                    </li>
                                    <li>
                                        In the integration’s <strong>OAuth domain &amp; URIs</strong>, add this redirect URI: <code>{typeof window !== 'undefined' ? `${window.location.origin}/api/notion/oauth/callback` : '/api/notion/oauth/callback'}</code>
                                    </li>
                                    <li>
                                        Copy the <strong>OAuth client ID</strong> and <strong>OAuth client secret</strong> into your project’s <code>.env.local</code>:
                                        <pre className="integration-setup-dialog-code">
{`NOTION_OAUTH_CLIENT_ID=your_client_id
NOTION_OAUTH_CLIENT_SECRET=your_client_secret`}
                                        </pre>
                                    </li>
                                    <li>Restart the app, then click Connect with Notion again.</li>
                                </ol>
                                <p className="integration-setup-dialog-alt">
                                    Alternatively, you can use an internal integration token: <code>NOTION_API_KEY</code> and <code>NOTION_TASKS_DATABASE_ID</code> in .env.local.
                                </p>
                                <div className="integration-setup-dialog-actions">
                                    <a href={NOTION_INTEGRATIONS_URL} target="_blank" rel="noopener noreferrer" className="btn-primary">
                                        Open Notion integrations
                                    </a>
                                    <button type="button" className="btn-secondary" onClick={() => setupDialogRef.current?.close()}>
                                        Close
                                    </button>
                                </div>
                            </div>
                        </dialog>
                        {!canConnect && (
                            <p className="integration-card-hint">
                                Add <code>NOTION_OAUTH_CLIENT_ID</code> and <code>NOTION_OAUTH_CLIENT_SECRET</code> to .env.local (from Notion → Settings → Connections → Develop), then restart the app. Or use <code>NOTION_API_KEY</code> and <code>NOTION_TASKS_DATABASE_ID</code>.
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
