'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/actions/auth';
import { useTheme } from '@/components/ThemeProvider';
import { type ReactNode, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'mission-control-sidebar-collapsed';

const allNavItems: Array<{ href: string; label: string; requiresNotion?: boolean; icon: ReactNode }> = [
    {
        href: '/agents',
        label: 'Agents',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
            </svg>
        ),
    },
    {
        href: '/chat',
        label: 'Chat',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
        ),
    },
    {
        href: '/models',
        label: 'Models',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
        ),
    },
    {
        href: '/tasks',
        label: 'Tasks',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
        ),
    },
    {
        href: '/integrations',
        label: 'Integrations',
        icon: (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
        ),
    },
];

const externalLinkIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
);

export function Sidebar({
    dashboardUrl = null,
    mobileOpen = false,
    onRequestClose,
}: {
    notionConfigured?: boolean;
    dashboardUrl?: string | null;
    mobileOpen?: boolean;
    onRequestClose?: () => void;
}) {
    const pathname = usePathname();
    const navItems = allNavItems;
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const sidebarRef = useRef<HTMLElement>(null);

    useEffect(() => setMounted(true), []);

    useEffect(() => {
        if (!mounted) return;
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored !== null) setCollapsed(stored === 'true');
        } catch {
            setCollapsed(false);
        }
    }, [mounted]);

    useEffect(() => {
        if (mobileOpen) onRequestClose?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]);

    useEffect(() => {
        if (!mobileOpen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const root = sidebarRef.current;
        const focusables = root?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const first = focusables?.[0];
        first?.focus();
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onRequestClose?.();
            if (e.key !== 'Tab') return;
            const currentRoot = sidebarRef.current;
            if (!currentRoot) return;
            const tabbables = Array.from(
                currentRoot.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )
            ).filter((el) => el.offsetParent !== null);
            if (tabbables.length === 0) return;
            const firstEl = tabbables[0];
            const lastEl = tabbables[tabbables.length - 1];
            const active = document.activeElement as HTMLElement | null;
            if (e.shiftKey && active === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && active === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [mobileOpen, onRequestClose]);

    const toggleCollapsed = () => {
        if (mobileOpen) {
            onRequestClose?.();
            return;
        }
        setCollapsed((prev) => {
            const next = !prev;
            try {
                localStorage.setItem(STORAGE_KEY, String(next));
            } catch {}
            return next;
        });
    };

    return (
        <aside
            ref={sidebarRef}
            className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${mobileOpen ? 'sidebar--mobile-open' : ''}`}
            aria-label="Sidebar"
        >
            <div className="sidebar-logo">
                <div className="logo-icon" title="OpenClaw Mission Control">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                </div>
                <div className="logo-text">
                    <span className="logo-name">OpenClaw</span>
                    <span className="logo-sub">Mission Control</span>
                </div>
                <button
                    type="button"
                    className="sidebar-toggle"
                    onClick={toggleCollapsed}
                    title={mobileOpen ? 'Close sidebar' : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
                    aria-label={mobileOpen ? 'Close sidebar' : (collapsed ? 'Expand sidebar' : 'Collapse sidebar')}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {collapsed ? (
                            <path d="M9 18l6-6-6-6" />
                        ) : (
                            <path d="M15 18l-6-6 6-6" />
                        )}
                    </svg>
                </button>
            </div>

            <nav className="sidebar-nav">
                <div className="nav-section-label">Overview</div>
                {navItems.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`nav-item ${isActive ? 'active' : ''}`}
                            title={item.label}
                            onClick={() => onRequestClose?.()}
                        >
                            <span className="nav-icon">{item.icon}</span>
                            <span className="nav-label">{item.label}</span>
                            {isActive && <span className="nav-indicator" />}
                        </Link>
                    );
                })}
            </nav>

            <div className="sidebar-signout">
                <form action={signOutAction} className="sidebar-signout-form">
                    <button type="submit" className="nav-item sidebar-signout-btn" title="Sign out">
                        <span className="nav-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                        </span>
                        <span className="nav-label">Sign out</span>
                    </button>
                </form>
            </div>

            <div className="sidebar-advanced">
                <div className="nav-section-label">Advanced</div>
                <Link
                    href="/heartbeat"
                    className={`nav-item ${pathname.startsWith('/heartbeat') ? 'active' : ''}`}
                    title="Configure heartbeat model"
                    onClick={() => onRequestClose?.()}
                >
                    <span className="nav-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                        </svg>
                    </span>
                    <span className="nav-label">Heartbeat</span>
                    {pathname.startsWith('/heartbeat') && <span className="nav-indicator" />}
                </Link>
                {dashboardUrl && (
                    <a
                        href={dashboardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="nav-item"
                        title="Open OpenClaw dashboard in a new tab"
                        onClick={() => onRequestClose?.()}
                    >
                        <span className="nav-icon">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="3" width="7" height="7" />
                                <rect x="14" y="3" width="7" height="7" />
                                <rect x="14" y="14" width="7" height="7" />
                                <rect x="3" y="14" width="7" height="7" />
                            </svg>
                        </span>
                        <span className="nav-label">OpenClaw Dashboard</span>
                        <span className="nav-icon" style={{ marginLeft: 'auto' }}>{externalLinkIcon}</span>
                    </a>
                )}
            </div>

            <div className="sidebar-footer">
                <div className="footer-status">
                    <div className="status-dot" />
                    <span className="status-text">Local mode</span>
                </div>
                {mounted && (
                    <div className="theme-toggle-group">
                        <button
                            className={`theme-btn ${theme === 'light' ? 'active' : ''}`}
                            onClick={() => setTheme('light')}
                            title="Light mode"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="5" />
                                <line x1="12" y1="1" x2="12" y2="3" />
                                <line x1="12" y1="21" x2="12" y2="23" />
                                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                                <line x1="1" y1="12" x2="3" y2="12" />
                                <line x1="21" y1="12" x2="23" y2="12" />
                                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                            </svg>
                        </button>
                        <button
                            className={`theme-btn ${theme === 'dark' ? 'active' : ''}`}
                            onClick={() => setTheme('dark')}
                            title="Dark mode"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                            </svg>
                        </button>
                        <button
                            className={`theme-btn ${theme === 'system' ? 'active' : ''}`}
                            onClick={() => setTheme('system')}
                            title="System setting"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                                <line x1="8" y1="21" x2="16" y2="21" />
                                <line x1="12" y1="17" x2="12" y2="21" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
        </aside>
    );
}
