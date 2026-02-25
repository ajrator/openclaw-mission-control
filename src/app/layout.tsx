import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LayoutShell } from '@/components/LayoutShell';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AlertConfirmProvider } from '@/components/AlertConfirmProvider';
import { getDashboardUrl } from '@/lib/openclaw';
import { isNotionConfigured } from '@/lib/notion';
import { auth } from '@/auth';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'OpenClaw Mission Control',
  description: 'Monitor and manage your OpenClaw agents',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const notionConfigured = isNotionConfigured();
  const dashboardUrl = getDashboardUrl();

  return (
    <html lang="en" className={`${inter.variable} suppressHydrationWarning`}>
      <body>
        <ThemeProvider>
          <AlertConfirmProvider>
            {session?.user ? (
              <LayoutShell notionConfigured={notionConfigured} dashboardUrl={dashboardUrl}>
                {children}
              </LayoutShell>
            ) : (
              children
            )}
          </AlertConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
