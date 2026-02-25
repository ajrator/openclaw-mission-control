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

const NOTION_INTEGRATIONS_URL = 'https://www.notion.so/my-integrations';

const DEFAULT_RETURN_TO = '/integrations';

export function NotionIntegrationCard({ connected, canDisconnect, canConnect, workspaceName, showSetupOnMount, notionTasksEnabled = true, returnTo = DEFAULT_RETURN_TO }: Props) {
    const router = useRouter();
    const [disconnecting, setDisconnecting] = useState(false);
    const [togglingTasks, setTogglingTasks] = useState(false);
    const setupDialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        if (showSetupOnMount && setupDialogRef.current) {
            setupDialogRef.current.showModal();
        }
    }, [showSetupOnMount]);

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
