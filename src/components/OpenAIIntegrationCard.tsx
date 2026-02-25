'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Props = {
    connected: boolean;
    canDisconnect: boolean;
    canConnect: boolean;
    accountIdMasked?: string | null;
    /** When true, show setup dialog on mount (e.g. after redirect from authorize with ?openai=setup_required) */
    showSetupOnMount?: boolean;
    /** Path to redirect to after OAuth (e.g. /onboarding/connect-openai). Default /integrations */
    returnTo?: string;
};

const OPENAI_DEVELOPER_DOCS = 'https://developers.openai.com/docs';

/** OpenAI icon (from https://www.svgrepo.com/svg/306500/openai). Inline so it always renders. */
function OpenAIIcon({ className, size = 28 }: { className?: string; size?: number }) {
    return (
        <svg
            className={className}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
        >
            <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
        </svg>
    );
}

const DEFAULT_RETURN_TO = '/integrations';

export function OpenAIIntegrationCard({
    connected,
    canDisconnect,
    canConnect,
    accountIdMasked,
    showSetupOnMount = false,
    returnTo = DEFAULT_RETURN_TO,
}: Props) {
    const router = useRouter();
    const [disconnecting, setDisconnecting] = useState(false);
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
            const res = await fetch('/api/openai/oauth/disconnect', { method: 'POST' });
            if (res.ok) router.refresh();
        } finally {
            setDisconnecting(false);
        }
    };

    return (
        <div className="integration-card">
            <div className="integration-card-header">
                <span className="integration-card-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <OpenAIIcon size={28} />
                </span>
                <div className="integration-card-title-row">
                    <h3 className="integration-card-name">OpenAI (Codex)</h3>
                    <span className={`integration-card-badge ${connected ? 'connected' : 'disconnected'}`}>
                        {connected ? 'Connected' : 'Not connected'}
                    </span>
                </div>
            </div>
            {connected && accountIdMasked && (
                <p className="integration-card-meta">Account: {accountIdMasked}</p>
            )}
            <p className="integration-card-desc">
                Connect with OpenAI (ChatGPT sign-in) to use the Codex model in OpenClaw. Your subscription is used for chat and coding in Mission Control.
            </p>
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
                {!connected && (
                    <>
                        <a href={`/api/openai/oauth/authorize?return_to=${encodeURIComponent(returnTo)}`} className="btn-primary">
                            Connect with OpenAI
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
                                <h3 className="integration-setup-dialog-title">Set up OpenAI (Codex) connection</h3>
                                <ol className="integration-setup-dialog-steps">
                                    <li>
                                        Create an OAuth app with OpenAI (or use one provided by your Mission Control distributor). See{' '}
                                        <a href={OPENAI_DEVELOPER_DOCS} target="_blank" rel="noopener noreferrer">
                                            OpenAI developer docs
                                        </a>
                                        {' '}for how to register an application.
                                    </li>
                                    <li>
                                        Add this redirect URI to your OAuth app: <code>{typeof window !== 'undefined' ? `${window.location.origin}/api/openai/oauth/callback` : '/api/openai/oauth/callback'}</code>
                                    </li>
                                    <li>
                                        Add the <strong>OAuth client ID</strong> and <strong>client secret</strong> to your project’s <code>.env.local</code>:
                                        <pre className="integration-setup-dialog-code">
{`OPENAI_OAUTH_CLIENT_ID=your_client_id
OPENAI_OAUTH_CLIENT_SECRET=your_client_secret`}
                                        </pre>
                                        Optional: <code>OPENAI_OAUTH_REDIRECT_URI</code> (defaults to <code>{typeof window !== 'undefined' ? `${window.location.origin}/api/openai/oauth/callback` : '.../api/openai/oauth/callback'}</code>).
                                    </li>
                                    <li>Restart the app, then click Connect with OpenAI again.</li>
                                </ol>
                                <p className="integration-setup-dialog-alt">
                                    Alternatively, run in a terminal: <code>openclaw models auth login --provider openai-codex</code> to sign in via the OpenClaw CLI.
                                </p>
                                <div className="integration-setup-dialog-actions">
                                    <a href={OPENAI_DEVELOPER_DOCS} target="_blank" rel="noopener noreferrer" className="btn-primary">
                                        OpenAI developer docs
                                    </a>
                                    <button type="button" className="btn-secondary" onClick={() => setupDialogRef.current?.close()}>
                                        Close
                                    </button>
                                </div>
                            </div>
                        </dialog>
                        {!canConnect && (
                            <p className="integration-card-hint">
                                Add <code>OPENAI_OAUTH_CLIENT_ID</code> and <code>OPENAI_OAUTH_CLIENT_SECRET</code> to .env.local, then restart the app. Or run <code>openclaw models auth login --provider openai-codex</code> in the terminal.
                            </p>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
