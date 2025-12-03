import { useEffect, useState } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@jybrd/design-system/components/ui/button';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Alert, AlertDescription } from '@jybrd/design-system/components/ui/alert';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { CreditCard, Sparkle, User } from '@phosphor-icons/react';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';

interface Subscription {
  plan: 'free' | 'pro';
  status?: string;
  trial?: boolean;
  trialEnd?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string;
}

export function UserSettings() {
  const { user, currentInstallation } = useAuth();
  const [subscription, setSubscription] = useState<Subscription>({ plan: 'free' });
  const [isLoading, setIsLoading] = useState(true);

  const installationId = currentInstallation?.id;

  // Load subscription data
  useEffect(() => {
    if (installationId) {
      loadSubscription();
    }
  }, [installationId]);

  // Check for checkout result from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      toast.success('Subscription activated! Welcome to Pro.');
      window.history.replaceState({}, '', '/app/settings');
    } else if (params.get('checkout') === 'canceled') {
      toast.error('Checkout canceled');
      window.history.replaceState({}, '', '/app/settings');
    }
  }, []);

  async function loadSubscription() {
    if (!installationId) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/installations/${installationId}/subscription`);
      if (res.ok) {
        const data = await res.json();
        setSubscription(data);
      }
    } catch (error) {
      console.error('Failed to load subscription:', error);
      toast.error('Failed to load subscription');
    } finally {
      setIsLoading(false);
    }
  }

  async function startCheckout() {
    if (!installationId) return;

    try {
      const res = await fetch(`/api/installations/${installationId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to start checkout');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error('Failed to start checkout');
    }
  }

  async function openBillingPortal() {
    if (!installationId) return;

    try {
      const res = await fetch(`/api/installations/${installationId}/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.ok) {
        const { url } = await res.json();
        window.location.href = url;
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to open billing portal');
      }
    } catch (error) {
      console.error('Portal error:', error);
      toast.error('Failed to open billing portal');
    }
  }

  const isPro = subscription.plan === 'pro';
  const isTrial = isPro && subscription.trial;

  return (
    <>
      <AppShell.Header title="Settings" description="Manage your account" />

      <AppShell.Body className="p-6 space-y-6 relative">
        <PageLoadingCover loading={isLoading} pageName="Settings" />
        {/* Trial Banner */}
        {isTrial && subscription.trialEnd && (
          <Alert>
            <Sparkle className="h-4 w-4" />
            <AlertDescription>
              {Math.ceil(
                (new Date(subscription.trialEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
              )}{' '}
              days left in your trial. Add a payment method to continue after the trial ends.
            </AlertDescription>
          </Alert>
        )}

        {/* Profile Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profile
            </CardTitle>
            <CardDescription>Your GitHub account information</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              {user?.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="h-16 w-16 rounded-full"
                />
              )}
              <div>
                <p className="font-medium text-lg">{user?.name || user?.login}</p>
                <p className="text-muted-foreground">@{user?.login}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscription Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Subscription
              </CardTitle>
              <CardDescription>
                {isPro
                  ? isTrial
                    ? 'Full access to all features during your trial.'
                    : subscription.cancelAtPeriodEnd
                    ? `Subscription ends ${new Date(subscription.currentPeriodEnd!).toLocaleDateString()}`
                    : `Renews ${new Date(subscription.currentPeriodEnd!).toLocaleDateString()}`
                  : 'Up to 25 tracked issues with core features.'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={isPro ? (isTrial ? 'secondary' : 'default') : 'outline'}>
                {isTrial ? 'Trial' : isPro ? 'Pro' : 'Free'}
              </Badge>
              {isPro ? (
                <Button variant="outline" onClick={openBillingPortal}>
                  {isTrial ? 'Add Payment Method' : 'Manage Subscription'}
                </Button>
              ) : (
                <Button onClick={startCheckout}>Upgrade to Pro - $9/mo</Button>
              )}
            </div>
          </CardHeader>
        </Card>
      </AppShell.Body>
    </>
  );
}
