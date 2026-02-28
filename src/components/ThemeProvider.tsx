'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
    theme: Theme;
    setTheme: (theme: Theme) => void;
    resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
const STORAGE_KEY = 'openclaw-theme';

function isTheme(value: unknown): value is Theme {
    return value === 'light' || value === 'dark' || value === 'system';
}

function getSystemTheme(): 'light' | 'dark' {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): 'light' | 'dark' {
    const resolved = theme === 'system' ? getSystemTheme() : theme;
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolved);
    root.style.colorScheme = resolved;
    return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

    // Initialize from storage and apply immediately on mount.
    useEffect(() => {
        let initial: Theme = 'system';
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (isTheme(saved)) initial = saved;
        } catch {
            // ignore
        }
        setThemeState(initial);
        setResolvedTheme(applyTheme(initial));
    }, []);

    // Keep DOM + storage synchronized whenever selected theme changes.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch {
            // ignore
        }
        setResolvedTheme(applyTheme(theme));
    }, [theme]);

    // In system mode, react to OS preference changes.
    useEffect(() => {
        if (theme !== 'system') return;
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => setResolvedTheme(applyTheme('system'));

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', onChange);
            return () => mediaQuery.removeEventListener('change', onChange);
        }
        mediaQuery.addListener(onChange);
        return () => mediaQuery.removeListener(onChange);
    }, [theme]);

    const setTheme = (next: Theme) => {
        setThemeState(next);
        if (typeof window !== 'undefined') setResolvedTheme(applyTheme(next));
    };

    return (
        <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
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

