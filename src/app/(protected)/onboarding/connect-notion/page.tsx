import Link from 'next/link';
import {
    isNotionConfigured,
    isNotionOAuthEnvSet,
    isNotionConfiguredViaOAuth,
    readNotionIntegrationFile,
} from '@/lib/notion';
import { isNotionTasksEnabled } from '@/lib/mission-control-prefs';
import { NotionIntegrationCard } from '@/components/NotionIntegrationCard';
import { NotionSelectDatabase } from '@/components/NotionSelectDatabase';

const CONNECT_NOTION_PATH = '/onboarding/connect-notion';

export default async function OnboardingConnectNotionPage({
    searchParams,
}: {
    searchParams: Promise<{ step?: string; notion?: string }>;
}) {
    const params = await searchParams;
    const stepSelectDatabase = params.step === 'select-database';
    const showSetupOnMount = params.notion === 'setup_required';

    const notionConnected = isNotionConfigured();
    const notionOAuthEnvSet = isNotionOAuthEnvSet();
    const notionCanDisconnect = isNotionConfiguredViaOAuth();
    const notionCanConnect = notionOAuthEnvSet;
    const notionTasksEnabled = isNotionTasksEnabled();
    const oauthFile = readNotionIntegrationFile();
    const workspaceName = oauthFile?.workspaceName ?? null;

    return (
        <div className="onboarding-connect-page">
            <p style={{ marginBottom: 16 }}>
                <Link href="/onboarding?step=integrations" className="link">
                    ← Back to setup
                </Link>
            </p>
            <h1 className="onboarding-title" style={{ marginBottom: 8 }}>
                Connect Notion
            </h1>
            <p className="onboarding-desc" style={{ marginBottom: 24 }}>
                Optional. Sync tasks with a Notion database. You can skip and set this up later.
            </p>
            {stepSelectDatabase ? (
                <div className="onboarding-connect-card">
                    <NotionSelectDatabase returnTo="/onboarding" />
                </div>
            ) : (
                <div className="onboarding-connect-card">
                    <NotionIntegrationCard
                        connected={notionConnected}
                        canDisconnect={notionCanDisconnect}
                        canConnect={notionCanConnect}
                        workspaceName={workspaceName}
                        showSetupOnMount={showSetupOnMount}
                        notionTasksEnabled={notionTasksEnabled}
                        returnTo={CONNECT_NOTION_PATH}
                    />
                </div>
            )}
        </div>
    );
}
