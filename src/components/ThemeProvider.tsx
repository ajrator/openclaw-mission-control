'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setTheme] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('dark');

    // Load saved theme on mount
    useEffect(() => {
        try {
            const savedTheme = localStorage.getItem('openclaw-theme') as Theme | null;
            if (savedTheme) {
                setTheme(savedTheme);
            }
        } catch {
            // ignore
        }
    }, []);

    // Update DOM when theme changes
    useEffect(() => {
        try {
            localStorage.setItem('openclaw-theme', theme);
        } catch {
            // ignore
        }

        const root = window.document.documentElement;
        const isDarkOS = window.matchMedia('(prefers-color-scheme: dark)').matches;

        root.classList.remove('light', 'dark');

        if (theme === 'system') {
            const systemTheme = isDarkOS ? 'dark' : 'light';
            root.classList.add(systemTheme);
            setResolvedTheme(systemTheme);
        } else {
            root.classList.add(theme);
            setResolvedTheme(theme);
        }
    }, [theme]);

    // Listen for system theme changes
    useEffect(() => {
        if (theme !== 'system') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e: MediaQueryListEvent) => {
            const root = window.document.documentElement;
            const systemTheme = e.matches ? 'dark' : 'light';

            root.classList.remove('light', 'dark');
            root.classList.add(systemTheme);
            setResolvedTheme(systemTheme);
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);

    // Prevent hydration mismatch flash by hiding until mounted
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const contextValue = { theme, setTheme, resolvedTheme };

    if (!mounted) {
        // Return an invisible wrapper during SSR to match structure without flashing wrong theme, but STILL provide context
        return (
            <div style={{ visibility: 'hidden' }}>
                <ThemeContext.Provider value={contextValue}>
                    {children}
                </ThemeContext.Provider>
            </div>
        );
    }

    return (
        <ThemeContext.Provider value={contextValue}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
