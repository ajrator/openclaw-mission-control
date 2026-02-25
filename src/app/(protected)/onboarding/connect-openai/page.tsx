import Link from 'next/link';
import {
    hasOpenAICodexProfile,
    isOpenAIOAuthEnvSet,
    getOpenAICodexProfileAccountIdMasked,
} from '@/lib/openai-oauth';
import { OpenAIIntegrationCard } from '@/components/OpenAIIntegrationCard';

const CONNECT_OPENAI_PATH = '/onboarding/connect-openai';

export default async function OnboardingConnectOpenAIPage({
    searchParams,
}: {
    searchParams: Promise<{ openai?: string }>;
}) {
    const params = await searchParams;
    const showSetupOnMount = params.openai === 'setup_required';

    const openaiConnected = hasOpenAICodexProfile();
    const openaiCanConnect = isOpenAIOAuthEnvSet();
    const openaiCanDisconnect = openaiConnected;
    const accountIdMasked = getOpenAICodexProfileAccountIdMasked();

    return (
        <div className="onboarding-connect-page">
            <p style={{ marginBottom: 16 }}>
                <Link href="/onboarding?step=integrations" className="link">
                    ← Back to setup
                </Link>
            </p>
            <h1 className="onboarding-title" style={{ marginBottom: 8 }}>
                Connect OpenAI (Codex)
            </h1>
            <p className="onboarding-desc" style={{ marginBottom: 24 }}>
                Optional. Use the Codex model in chat. You can skip and set this up later.
            </p>
            <div className="onboarding-connect-card">
                <OpenAIIntegrationCard
                    connected={openaiConnected}
                    canDisconnect={openaiCanDisconnect}
                    canConnect={openaiCanConnect}
                    accountIdMasked={accountIdMasked}
                    showSetupOnMount={showSetupOnMount}
                    returnTo={CONNECT_OPENAI_PATH}
                />
            </div>
        </div>
    );
}
