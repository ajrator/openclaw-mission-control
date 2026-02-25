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

    useEffect(() => {
        if (pathname?.startsWith('/onboarding') || pathname?.startsWith('/api/')) {
            setChecked(true);
            return;
        }
        fetch('/api/setup/onboarding/status')
            .then((r) => r.json())
            .then((data: { completed?: boolean }) => {
                setChecked(true);
                if (data.completed !== true) {
                    router.replace('/onboarding');
                }
            })
            .catch(() => setChecked(true));
    }, [pathname, router]);

    if (pathname?.startsWith('/onboarding')) {
        return <div className="onboarding-full">{children}</div>;
    }

    if (!checked) {
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
            <Sidebar notionConfigured={notionConfigured} dashboardUrl={dashboardUrl} />
            <main className="main-content">{children}</main>
        </div>
    );
}
