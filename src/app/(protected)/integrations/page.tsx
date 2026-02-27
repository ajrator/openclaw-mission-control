import Link from 'next/link';
import { isNotionConfigured, isNotionOAuthEnvSet, isNotionConfiguredViaOAuth, readNotionIntegrationFile } from '@/lib/notion';
import { isNotionTasksEnabled } from '@/lib/mission-control-prefs';
import { hasOpenAICodexProfile, isOpenAIOAuthEnvSet, getOpenAICodexProfileAccountIdMasked } from '@/lib/openai-oauth';
import { NotionIntegrationCard } from '@/components/NotionIntegrationCard';
import { NotionSelectDatabase } from '@/components/NotionSelectDatabase';
import { OpenAIIntegrationCard } from '@/components/OpenAIIntegrationCard';
import { GatewaySetupCard } from '@/components/GatewaySetupCard';

type Props = { searchParams: Promise<{ notion?: string; step?: string; openai?: string; from?: string }> };

export default async function IntegrationsPage({ searchParams }: Props) {
    const notionConnected = isNotionConfigured();
    const notionOAuthEnvSet = isNotionOAuthEnvSet();
    const showNotionIntegration = notionOAuthEnvSet || notionConnected;
    const notionCanDisconnect = isNotionConfiguredViaOAuth();
    const notionCanConnect = isNotionOAuthEnvSet();
    const notionTasksEnabled = isNotionTasksEnabled();
    const oauthFile = readNotionIntegrationFile();
    const workspaceName = oauthFile?.workspaceName ?? null;

    const openaiConnected = hasOpenAICodexProfile();
    const openaiCanConnect = isOpenAIOAuthEnvSet();
    const openaiCanDisconnect = openaiConnected;
    const openaiAccountIdMasked = getOpenAICodexProfileAccountIdMasked();

    const params = await searchParams;
    const showNotionSetup = params.notion === 'setup_required';
    const showOpenAISetup = params.openai === 'setup_required';
    const stepSelectDatabase = params.step === 'select-database';
    const fromOnboarding = params.from === 'onboarding';

    return (
        <div className="page">
            <div className="page-header">
                <div>
                    {fromOnboarding && (
                        <p style={{ marginBottom: 8 }}>
                            <Link href="/onboarding" className="link">
                                ← Back to setup
                            </Link>
                        </p>
                    )}
                    <h1 className="page-title">Integrations</h1>
                    <p className="page-subtitle">
                        Optional: connect Notion or OpenAI to enhance tasks and chat
                    </p>
                </div>
            </div>

            {stepSelectDatabase ? (
                <div className="integrations-grid">
                    <div className="integration-card">
                        <div className="integration-card-header">
                            <img
                                src="/images/notion-favicon.ico"
                                alt=""
                                className="integration-card-icon"
                                width={28}
                                height={28}
                            />
                            <h3 className="integration-card-name" style={{ margin: 0 }}>Notion — choose database</h3>
                        </div>
                        <p className="integration-card-desc">
                            Pick which Notion database to use for the Tasks board.
                        </p>
                        <NotionSelectDatabase returnTo="/integrations" />
                    </div>
                </div>
            ) : (
                <div className="integrations-grid">
                    <GatewaySetupCard />
                    {showNotionIntegration && (
                        <NotionIntegrationCard
                            connected={notionConnected}
                            canDisconnect={notionCanDisconnect}
                            canConnect={notionCanConnect}
                            workspaceName={workspaceName}
                            showSetupOnMount={showNotionSetup}
                            notionTasksEnabled={notionTasksEnabled}
                        />
                    )}
                    <OpenAIIntegrationCard
                        connected={openaiConnected}
                        canDisconnect={openaiCanDisconnect}
                        canConnect={openaiCanConnect}
                        accountIdMasked={openaiAccountIdMasked}
                        showSetupOnMount={showOpenAISetup}
                    />
                </div>
            )}

            {!showNotionIntegration && !openaiCanConnect && !openaiConnected && (
                <div className="empty-state">
                    <p className="page-subtitle" style={{ marginTop: 8 }}>
                        Notion and OpenAI are optional. You can use tasks and chat without them. To connect later, add Notion OAuth env vars (NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET) or OpenAI OAuth env vars (OPENAI_OAUTH_CLIENT_ID, OPENAI_OAUTH_CLIENT_SECRET), or use the setup instructions on each integration card.
                    </p>
                </div>
            )}
        </div>
    );
}
