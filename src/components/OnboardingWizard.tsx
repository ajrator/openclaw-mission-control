'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const STEPS = ['welcome', 'backend', 'integrations', 'done'] as const;
type Step = (typeof STEPS)[number];

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
        configured: boolean;
        reachable: boolean;
        loading: boolean;
        installing: boolean;
        error: string | null;
    }>({ configured: false, reachable: false, loading: true, installing: false, error: null });

    const fetchGatewayStatus = useCallback(async () => {
        const res = await fetch('/api/setup/gateway/status');
        const data = await res.json();
        return data as { configured: boolean; reachable: boolean; ready: boolean };
    }, []);

    useEffect(() => {
        if (step !== 'backend') return;
        let cancelled = false;
        setBackendStatus((s) => ({ ...s, loading: true, installing: false, error: null }));
        fetchGatewayStatus()
            .then((data) => {
                if (cancelled) return;
                setBackendStatus({
                    configured: data.configured,
                    reachable: data.reachable,
                    loading: false,
                    installing: false,
                    error: null,
                });
            })
            .catch(() => {
                if (!cancelled) {
                    setBackendStatus((s) => ({ ...s, loading: false, installing: false, error: 'Could not check status' }));
                }
            });
        return () => {
            cancelled = true;
        };
    }, [step, fetchGatewayStatus]);

    const handleInstallAndStart = async () => {
        setBackendStatus((s) => ({ ...s, loading: true, installing: true, error: null }));
        try {
            const installRes = await fetch('/api/setup/gateway/install', { method: 'POST' });
            const installData = await installRes.json();
            if (!installData.ok) {
                setBackendStatus((s) => ({ ...s, loading: false, installing: false, error: installData.error || 'Install failed' }));
                return;
            }
            const startRes = await fetch('/api/setup/gateway/start', { method: 'POST' });
            const startData = await startRes.json();
            if (!startData.ok) {
                setBackendStatus((s) => ({ ...s, loading: false, installing: false, error: startData.error || 'Start failed' }));
                return;
            }
            for (let i = 0; i < 30; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                const status = await fetchGatewayStatus();
                if (status.ready) {
                    setBackendStatus({ configured: true, reachable: true, loading: false, installing: false, error: null });
                    return;
                }
            }
            setBackendStatus((s) => ({ ...s, loading: false, installing: false, error: 'Gateway did not become ready in time' }));
        } catch (err) {
            setBackendStatus((s) => ({
                ...s,
                loading: false,
                installing: false,
                error: err instanceof Error ? err.message : 'Something went wrong',
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
                    {backendStatus.loading && !backendStatus.installing && (
                        <p className="onboarding-desc">Checking…</p>
                    )}
                    {backendStatus.loading && backendStatus.installing && (
                        <p className="onboarding-desc">Installing and starting…</p>
                    )}
                    {backendStatus.error && (
                        <p className="onboarding-desc onboarding-error">{backendStatus.error}</p>
                    )}
                    {!backendStatus.loading && backendStatus.reachable && (
                        <p className="onboarding-desc">Connected. You&apos;re good to go.</p>
                    )}
                    {!backendStatus.loading && !backendStatus.reachable && !backendStatus.error && (
                        <p className="onboarding-desc">Your assistant engine isn&apos;t running yet. Install and start it to continue.</p>
                    )}
                    {!backendStatus.loading && !backendStatus.reachable && !backendStatus.error && (
                        <button
                            type="button"
                            className="onboarding-cta onboarding-cta-secondary"
                            onClick={handleInstallAndStart}
                        >
                            Install and start
                        </button>
                    )}
                    {!backendStatus.loading && backendStatus.reachable && (
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
                                setBackendStatus((s) => ({ ...s, loading: true, error: null }));
                                handleInstallAndStart();
                            }}
                        >
                            Retry
                        </button>
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
