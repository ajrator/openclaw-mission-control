import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isOnboardingCompleted } from '@/lib/mission-control-prefs';
import { LandingPage } from '@/components/LandingPage';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  if (!session?.user) {
    const hasGoogle = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
    return <LandingPage hasGoogle={hasGoogle} authError={params.error} />;
  }
  if (!isOnboardingCompleted()) {
    redirect('/onboarding');
  }
  redirect('/agents');
}
