'use client';

import { useEffect, useState } from 'react';

type GatewayStatus = {
    installed: boolean;
    installMethod: 'global' | 'npx_only' | 'unknown';
    configured: boolean;
    reachable: boolean;
    ready: boolean;
    state: 'missing' | 'installed_not_configured' | 'configured_not_running' | 'ready';
    diagnostics?: {
        openclawDirExists: boolean;
        configExists: boolean;
        gatewayUrl: string | null;
        npxAvailable: boolean;
        nodeAvailable: boolean;
        lastError?: string;
    };
};

type GatewayPreflight = {
    ok: boolean;
    checks: { node: boolean; npx: boolean; networkLikely: boolean; writableHome: boolean };
    message?: string;
};

function stateLabel(state: GatewayStatus['state']): string {
    if (state === 'missing') return 'OpenClaw not installed';
    if (state === 'installed_not_configured') return 'Installed, not configured';
    if (state === 'configured_not_running') return 'Configured, not running';
    return 'Ready';
}

export function GatewaySetupCard() {
    const [status, setStatus] = useState<GatewayStatus | null>(null);
    const [preflight, setPreflight] = useState<GatewayPreflight | null>(null);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/setup/gateway/status', { cache: 'no-store' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not load setup status');
            setStatus(data as GatewayStatus);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not load setup status');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refreshStatus();
    }, []);

    const runInstallAndStart = async () => {
        setWorking(true);
        setError(null);
        try {
            const preflightRes = await fetch('/api/setup/gateway/preflight', { cache: 'no-store' });
            const preflightData = await preflightRes.json().catch(() => ({}));
            if (!preflightRes.ok) throw new Error(preflightData.error || 'Preflight failed');
            setPreflight(preflightData as GatewayPreflight);
            if (!preflightData.ok) throw new Error(preflightData.message || 'Preflight failed');

            const installRes = await fetch('/api/setup/gateway/install', { method: 'POST' });
            const installData = await installRes.json().catch(() => ({}));
            if (!installRes.ok || !installData.ok) throw new Error(installData.error || installData.hint || 'Install failed');

            const startRes = await fetch('/api/setup/gateway/start', { method: 'POST' });
            const startData = await startRes.json().catch(() => ({}));
            if (!startRes.ok || !startData.ok) throw new Error(startData.error || startData.hint || 'Start failed');

            for (let i = 0; i < 20; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                const statusRes = await fetch('/api/setup/gateway/status', { cache: 'no-store' });
                const statusData = await statusRes.json().catch(() => ({}));
                if (statusRes.ok) {
                    setStatus(statusData as GatewayStatus);
                    if ((statusData as GatewayStatus).state === 'ready') break;
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Setup failed');
        } finally {
            setWorking(false);
        }
    };

    const startOnly = async () => {
        setWorking(true);
        setError(null);
        try {
            const startRes = await fetch('/api/setup/gateway/start', { method: 'POST' });
            const startData = await startRes.json().catch(() => ({}));
            if (!startRes.ok || !startData.ok) throw new Error(startData.error || startData.hint || 'Start failed');
            await refreshStatus();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Start failed');
        } finally {
            setWorking(false);
        }
    };

    const state = status?.state ?? 'missing';
    const canInstall = state === 'missing' || state === 'installed_not_configured';
    const canStart = state === 'configured_not_running';

    return (
        <div className="integration-card">
            <div className="integration-card-header">
                <span className="integration-card-icon" aria-hidden>⚙️</span>
                <div className="integration-card-title-row">
                    <h3 className="integration-card-name">OpenClaw Setup</h3>
                    {status && (
                        <span className={`integration-card-badge ${state === 'ready' ? 'connected' : 'disconnected'}`}>
                            {stateLabel(status.state)}
                        </span>
                    )}
                </div>
            </div>
            <p className="integration-card-desc">
                Mission Control can install/configure/start OpenClaw gateway from here. This is required for chat and agent task execution.
            </p>

            {loading && <p className="integration-card-hint" style={{ padding: '0 1rem 1rem' }}>Checking setup status…</p>}
            {error && <p className="integration-card-hint" style={{ padding: '0 1rem 1rem', color: '#dc2626' }}>{error}</p>}

            <div className="integration-card-actions">
                <button type="button" className="btn-secondary" onClick={refreshStatus} disabled={loading || working}>
                    Refresh status
                </button>
                {canInstall && (
                    <button type="button" className="btn-primary" onClick={runInstallAndStart} disabled={working || loading}>
                        {working ? 'Installing…' : 'Install and start'}
                    </button>
                )}
                {canStart && (
                    <button type="button" className="btn-primary" onClick={startOnly} disabled={working || loading}>
                        {working ? 'Starting…' : 'Start gateway'}
                    </button>
                )}
            </div>

            {(status || preflight) && (
                <details style={{ margin: '0 1rem 1rem' }}>
                    <summary className="integration-card-hint" style={{ cursor: 'pointer' }}>Technical details</summary>
                    <pre className="integration-setup-dialog-code" style={{ marginTop: 8 }}>
{JSON.stringify({ status, preflight }, null, 2)}
                    </pre>
                </details>
            )}
        </div>
    );
}
