'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';

export function LayoutShell({
    children,
    notionConfigured,
    dashboardUrl,
}: {
    children: React.ReactNode;
    notionConfigured: boolean;
    dashboardUrl: string | null;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [checked, setChecked] = useState(false);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const bypassOnboardingCheck = pathname?.startsWith('/onboarding') || pathname?.startsWith('/api/');

    const pageTitle = pathname?.startsWith('/agents')
        ? 'Agents'
        : pathname?.startsWith('/chat')
            ? 'Chat'
            : pathname?.startsWith('/models')
                ? 'Models'
                : pathname?.startsWith('/tasks')
                    ? 'Tasks'
                    : pathname?.startsWith('/integrations')
                        ? 'Integrations'
                        : pathname?.startsWith('/heartbeat')
                            ? 'Heartbeat'
                            : 'Mission Control';

    useEffect(() => {
        if (bypassOnboardingCheck) return;
        fetch('/api/setup/onboarding/status')
            .then((r) => r.json())
            .then((data: { completed?: boolean }) => {
                setChecked(true);
                if (data.completed !== true) {
                    router.replace('/onboarding');
                }
            })
            .catch(() => setChecked(true));
    }, [bypassOnboardingCheck, router]);

    if (pathname?.startsWith('/onboarding')) {
        return <div className="onboarding-full">{children}</div>;
    }

    if (!bypassOnboardingCheck && !checked) {
        return (
            <div className="app-shell">
                <div className="main-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                    <p className="page-subtitle">Loading…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="app-shell">
            <Sidebar
                notionConfigured={notionConfigured}
                dashboardUrl={dashboardUrl}
                mobileOpen={mobileSidebarOpen}
                onRequestClose={() => setMobileSidebarOpen(false)}
            />
            {mobileSidebarOpen && (
                <button
                    type="button"
                    className="sidebar-mobile-backdrop"
                    aria-label="Close navigation"
                    onClick={() => setMobileSidebarOpen(false)}
                />
            )}
            <main className="main-content">
                <div className="app-mobile-topbar">
                    <button
                        type="button"
                        className="app-mobile-menu-btn"
                        onClick={() => setMobileSidebarOpen(true)}
                        aria-label="Open navigation"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="3" y1="6" x2="21" y2="6" />
                            <line x1="3" y1="12" x2="21" y2="12" />
                            <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                    </button>
                    <div className="app-mobile-title">{pageTitle}</div>
                </div>
                {children}
            </main>
        </div>
    );
}
