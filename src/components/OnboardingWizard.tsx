'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const STEPS = ['welcome', 'backend', 'integrations', 'done'] as const;
type Step = (typeof STEPS)[number];

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

function stepFromParam(param: string | null): Step | null {
    if (param && STEPS.includes(param as Step)) return param as Step;
    return null;
}

export function OnboardingWizard() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const stepParam = searchParams.get('step');
    const [step, setStep] = useState<Step>(() => stepFromParam(stepParam) ?? 'welcome');

    useEffect(() => {
        const fromUrl = stepFromParam(stepParam);
        if (fromUrl) setStep(fromUrl);
    }, [stepParam]);

    useEffect(() => {
        if (stepParam !== step) {
            router.replace(`/onboarding?step=${step}`, { scroll: false });
        }
    }, [step, stepParam, router]);

    const [backendStatus, setBackendStatus] = useState<{
        state: GatewayStatus['state'] | null;
        status: GatewayStatus | null;
        preflight: GatewayPreflight | null;
        loading: boolean;
        runningStep: 'checking' | 'checking_prerequisites' | 'installing' | 'configuring' | 'starting' | 'verifying' | null;
        error: string | null;
        errorHint: string | null;
        detailsOpen: boolean;
    }>({
        state: null,
        status: null,
        preflight: null,
        loading: true,
        runningStep: 'checking',
        error: null,
        errorHint: null,
        detailsOpen: false,
    });

    const fetchGatewayStatus = useCallback(async () => {
        const res = await fetch('/api/setup/gateway/status', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Could not load gateway status');
        return data as GatewayStatus;
    }, []);

    const fetchPreflight = useCallback(async () => {
        const res = await fetch('/api/setup/gateway/preflight', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || 'Could not run setup preflight');
        return data as GatewayPreflight;
    }, []);

    useEffect(() => {
        if (step !== 'backend') return;
        let cancelled = false;
        setBackendStatus((s) => ({ ...s, loading: true, runningStep: 'checking', error: null, errorHint: null }));
        fetchGatewayStatus()
            .then((data) => {
                if (cancelled) return;
                setBackendStatus({
                    state: data.state,
                    status: data,
                    preflight: null,
                    loading: false,
                    runningStep: null,
                    error: null,
                    errorHint: null,
                    detailsOpen: false,
                });
            })
            .catch(() => {
                if (!cancelled) {
                    setBackendStatus((s) => ({ ...s, loading: false, runningStep: null, error: 'Could not check status', errorHint: 'Retry and verify your local network and file permissions.' }));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [step, fetchGatewayStatus]);

    const handleInstallAndStart = async () => {
        setBackendStatus((s) => ({ ...s, loading: true, runningStep: 'checking_prerequisites', error: null, errorHint: null, preflight: null }));
        try {
            const preflight = await fetchPreflight();
            if (!preflight.ok) {
                setBackendStatus((s) => ({
                    ...s,
                    loading: false,
                    runningStep: null,
                    preflight,
                    error: preflight.message || 'Setup preflight failed',
                    errorHint: 'Install Node.js and ensure npx can run, then retry.',
                }));
                return;
            }
            setBackendStatus((s) => ({ ...s, preflight, runningStep: 'installing' }));
            const installRes = await fetch('/api/setup/gateway/install', { method: 'POST' });
            const installData = await installRes.json().catch(() => ({}));
            if (!installData.ok) {
                setBackendStatus((s) => ({
                    ...s,
                    loading: false,
                    runningStep: null,
                    error: installData.error || 'Install failed',
                    errorHint: installData.hint || 'Review technical details below and retry.',
                }));
                return;
            }
            setBackendStatus((s) => ({ ...s, runningStep: 'starting' }));
            const startRes = await fetch('/api/setup/gateway/start', { method: 'POST' });
            const startData = await startRes.json().catch(() => ({}));
            if (!startData.ok) {
                setBackendStatus((s) => ({
                    ...s,
                    loading: false,
                    runningStep: null,
                    error: startData.error || 'Start failed',
                    errorHint: startData.hint || 'Gateway could not be started automatically.',
                }));
                return;
            }
            setBackendStatus((s) => ({ ...s, runningStep: 'verifying' }));
            for (let i = 0; i < 30; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                const status = await fetchGatewayStatus();
                if (status.state === 'ready') {
                    setBackendStatus({
                        state: status.state,
                        status,
                        preflight,
                        loading: false,
                        runningStep: null,
                        error: null,
                        errorHint: null,
                        detailsOpen: false,
                    });
                    return;
                }
            }
            const status = await fetchGatewayStatus();
            setBackendStatus({
                state: status.state,
                status,
                preflight,
                loading: false,
                runningStep: null,
                error: 'Gateway did not become ready in time',
                errorHint: 'Try again. If this persists, open technical details and verify configuration.',
                detailsOpen: true,
            });
        } catch (err) {
            setBackendStatus((s) => ({
                ...s,
                loading: false,
                runningStep: null,
                error: err instanceof Error ? err.message : 'Something went wrong',
                errorHint: 'Retry setup and check if Node.js and npx are installed.',
            }));
        }
    };

    const handleStartOnly = async () => {
        setBackendStatus((s) => ({ ...s, loading: true, runningStep: 'starting', error: null, errorHint: null }));
        try {
            const startRes = await fetch('/api/setup/gateway/start', { method: 'POST' });
            const startData = await startRes.json().catch(() => ({}));
            if (!startData.ok) {
                setBackendStatus((s) => ({
                    ...s,
                    loading: false,
                    runningStep: null,
                    error: startData.error || 'Start failed',
                    errorHint: startData.hint || 'Gateway failed to start.',
                }));
                return;
            }
            setBackendStatus((s) => ({ ...s, runningStep: 'verifying' }));
            for (let i = 0; i < 30; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                const status = await fetchGatewayStatus();
                if (status.state === 'ready') {
                    setBackendStatus({
                        state: status.state,
                        status,
                        preflight: backendStatus.preflight,
                        loading: false,
                        runningStep: null,
                        error: null,
                        errorHint: null,
                        detailsOpen: false,
                    });
                    return;
                }
            }
            const status = await fetchGatewayStatus();
            setBackendStatus((s) => ({
                ...s,
                state: status.state,
                status,
                loading: false,
                runningStep: null,
                error: 'Gateway did not become ready in time',
                errorHint: 'Retry start. If this persists, run install/configure first.',
                detailsOpen: true,
            }));
        } catch (err) {
            setBackendStatus((s) => ({
                ...s,
                loading: false,
                runningStep: null,
                error: err instanceof Error ? err.message : 'Something went wrong',
                errorHint: 'Retry and verify OpenClaw installation.',
            }));
        }
    };

    const handleComplete = async (skippedNotion?: boolean, skippedOpenAI?: boolean) => {
        await fetch('/api/setup/onboarding/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skippedNotion, skippedOpenAI }),
        });
        router.push('/agents');
        router.refresh();
    };

    const stepIndex = STEPS.indexOf(step);

    return (
        <div className="onboarding-wizard">
            <div className="onboarding-progress">
                {STEPS.map((s, i) => (
                    <div
                        key={s}
                        className={`onboarding-progress-dot ${i <= stepIndex ? 'active' : ''} ${i < stepIndex ? 'done' : ''}`}
                    />
                ))}
            </div>

            {step === 'welcome' && (
                <div className="onboarding-step">
                    <h1 className="onboarding-title">Set up your workspace</h1>
                    <p className="onboarding-desc">
                        This will only take a minute. We&apos;ll make sure your assistant engine is running, then you can optionally connect Notion or OpenAI.
                    </p>
                    <button
                        type="button"
                        className="onboarding-cta"
                        onClick={() => setStep('backend')}
                    >
                        Get started
                    </button>
                </div>
            )}

            {step === 'backend' && (
                <div className="onboarding-step">
                    <h1 className="onboarding-title">Your assistant engine</h1>
                    {backendStatus.loading && (
                        <p className="onboarding-desc">
                            {backendStatus.runningStep === 'checking_prerequisites' && 'Checking prerequisites…'}
                            {backendStatus.runningStep === 'installing' && 'Installing OpenClaw…'}
                            {backendStatus.runningStep === 'configuring' && 'Configuring gateway…'}
                            {backendStatus.runningStep === 'starting' && 'Starting gateway…'}
                            {backendStatus.runningStep === 'verifying' && 'Verifying connection…'}
                            {(backendStatus.runningStep === 'checking' || backendStatus.runningStep === null) && 'Checking…'}
                        </p>
                    )}
                    {backendStatus.error && (
                        <p className="onboarding-desc onboarding-error">{backendStatus.error}</p>
                    )}
                    {backendStatus.errorHint && (
                        <p className="onboarding-desc">{backendStatus.errorHint}</p>
                    )}
                    {!backendStatus.loading && backendStatus.state === 'ready' && (
                        <p className="onboarding-desc">Connected. You&apos;re good to go.</p>
                    )}
                    {!backendStatus.loading && backendStatus.state === 'missing' && !backendStatus.error && (
                        <p className="onboarding-desc">OpenClaw is not installed yet. Install and start it to continue.</p>
                    )}
                    {!backendStatus.loading && backendStatus.state === 'installed_not_configured' && !backendStatus.error && (
                        <p className="onboarding-desc">OpenClaw is installed, but gateway config is missing. Configure and start to continue.</p>
                    )}
                    {!backendStatus.loading && backendStatus.state === 'configured_not_running' && !backendStatus.error && (
                        <p className="onboarding-desc">Gateway is configured but not running. Start it to continue.</p>
                    )}
                    {!backendStatus.loading &&
                        (backendStatus.state === 'missing' || backendStatus.state === 'installed_not_configured') &&
                        !backendStatus.error && (
                        <button
                            type="button"
                            className="onboarding-cta onboarding-cta-secondary"
                            onClick={handleInstallAndStart}
                        >
                            Install and start
                        </button>
                    )}
                    {!backendStatus.loading && backendStatus.state === 'configured_not_running' && !backendStatus.error && (
                        <button
                            type="button"
                            className="onboarding-cta onboarding-cta-secondary"
                            onClick={handleStartOnly}
                        >
                            Start gateway
                        </button>
                    )}
                    {!backendStatus.loading && backendStatus.state === 'ready' && (
                        <button
                            type="button"
                            className="onboarding-cta"
                            onClick={() => setStep('integrations')}
                        >
                            Continue
                        </button>
                    )}
                    {backendStatus.error && (
                        <button
                            type="button"
                            className="onboarding-cta onboarding-cta-secondary"
                            onClick={() => {
                                setBackendStatus((s) => ({ ...s, loading: true, runningStep: 'checking', error: null, errorHint: null }));
                                handleInstallAndStart();
                            }}
                        >
                            Retry
                        </button>
                    )}
                    {!backendStatus.loading && (
                        <details
                            style={{ marginTop: 16 }}
                            open={backendStatus.detailsOpen}
                            onToggle={(e) => setBackendStatus((s) => ({ ...s, detailsOpen: (e.target as HTMLDetailsElement).open }))}
                        >
                            <summary className="onboarding-desc" style={{ cursor: 'pointer' }}>Technical details</summary>
                            <pre className="integration-setup-dialog-code" style={{ marginTop: 8 }}>
{JSON.stringify(
    {
        state: backendStatus.state,
        status: backendStatus.status,
        preflight: backendStatus.preflight,
    },
    null,
    2
)}
                            </pre>
                        </details>
                    )}
                </div>
            )}

            {step === 'integrations' && (
                <div className="onboarding-step">
                    <h1 className="onboarding-title">Connect services (optional)</h1>
                    <p className="onboarding-desc">
                        You can use tasks and chat without these. Connect Notion to sync tasks with a database, or OpenAI for Codex in chat. You can always set these up later in Integrations.
                    </p>
                    <div className="onboarding-integrations">
                        <Link href="/onboarding/connect-notion?notion=setup_required" className="onboarding-integration-link">
                            Connect Notion
                        </Link>
                        <Link href="/onboarding/connect-openai?openai=setup_required" className="onboarding-integration-link">
                            Connect OpenAI (Codex)
                        </Link>
                    </div>
                    <button
                        type="button"
                        className="onboarding-cta"
                        onClick={() => setStep('done')}
                    >
                        Skip for now
                    </button>
                </div>
            )}

            {step === 'done' && (
                <div className="onboarding-step">
                    <h1 className="onboarding-title">You&apos;re all set</h1>
                    <p className="onboarding-desc">Start using your workspace.</p>
                    <button
                        type="button"
                        className="onboarding-cta"
                        onClick={() => handleComplete()}
                    >
                        Go to workspace
                    </button>
                </div>
            )}
        </div>
    );
}
