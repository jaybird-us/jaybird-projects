import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@jybrd/design-system/components/ui/button';
import { Input } from '@jybrd/design-system/components/ui/input';
import { Label } from '@jybrd/design-system/components/ui/label';
import { Checkbox } from '@jybrd/design-system/components/ui/checkbox';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Separator } from '@jybrd/design-system/components/ui/separator';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';
import { Calendar, Clock, TShirt, Sparkle, Lock, Trash } from '@phosphor-icons/react';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const CONFIDENCE_LEVELS = ['High', 'Medium', 'Low'];

interface Settings {
  weekendDays: number[];
  estimateDays: Record<string, number>;
  confidenceBuffer: Record<string, number>;
}

interface Holiday {
  date: string;
  name: string;
  recurring: boolean;
}

interface Subscription {
  plan: 'free' | 'pro';
  status?: string;
  trial?: boolean;
  trialEnd?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string;
}

const DEFAULT_SETTINGS: Settings = {
  weekendDays: [0, 6],
  estimateDays: { XS: 2, S: 5, M: 10, L: 15, XL: 25, XXL: 40 },
  confidenceBuffer: { High: 0, Medium: 2, Low: 5 },
};

export function Configuration() {
  const { currentInstallation } = useAuth();

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [subscription, setSubscription] = useState<Subscription>({ plan: 'free' });
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [newHoliday, setNewHoliday] = useState({ date: '', name: '', recurring: false });
  const [isLoading, setIsLoading] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  const installationId = currentInstallation?.id;

  // Load settings and subscription
  useEffect(() => {
    if (installationId) {
      loadData();
    }
  }, [installationId]);

  // Track changes
  useEffect(() => {
    setHasChanges(JSON.stringify(settings) !== JSON.stringify(originalSettings));
  }, [settings, originalSettings]);

  async function loadData() {
    if (!installationId) return;

    setIsLoading(true);
    try {
      const [settingsRes, subscriptionRes] = await Promise.all([
        fetch(`/api/installations/${installationId}/settings`),
        fetch(`/api/installations/${installationId}/subscription`),
      ]);

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setSettings(data);
        setOriginalSettings(data);
      }

      if (subscriptionRes.ok) {
        const data = await subscriptionRes.json();
        setSubscription(data);
      }

      // Load holidays if Pro
      const subData = await subscriptionRes.json().catch(() => ({ plan: 'free' }));
      if (subData.plan === 'pro') {
        await loadHolidays();
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadHolidays() {
    if (!installationId) return;

    try {
      const res = await fetch(`/api/installations/${installationId}/holidays`);
      if (res.ok) {
        const data = await res.json();
        setHolidays(data.holidays || []);
      }
    } catch (error) {
      console.error('Failed to load holidays:', error);
    }
  }

  const toggleWorkDay = useCallback((dayIndex: number) => {
    setSettings((prev) => {
      const isWeekend = prev.weekendDays.includes(dayIndex);
      return {
        ...prev,
        weekendDays: isWeekend
          ? prev.weekendDays.filter((d) => d !== dayIndex)
          : [...prev.weekendDays, dayIndex].sort(),
      };
    });
  }, []);

  const updateEstimate = useCallback((size: string, value: number) => {
    setSettings((prev) => ({
      ...prev,
      estimateDays: { ...prev.estimateDays, [size]: value },
    }));
  }, []);

  const updateConfidence = useCallback((level: string, value: number) => {
    setSettings((prev) => ({
      ...prev,
      confidenceBuffer: { ...prev.confidenceBuffer, [level]: value },
    }));
  }, []);

  async function saveSettings() {
    if (!installationId) return;

    try {
      const res = await fetch(`/api/installations/${installationId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        toast.success('Settings saved successfully');
        setOriginalSettings(settings);
        setHasChanges(false);
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to save settings');
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      toast.error('Failed to save settings');
    }
  }

  function resetSettings() {
    setSettings(originalSettings);
    setHasChanges(false);
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

  async function addHoliday() {
    if (!installationId || !newHoliday.date) {
      toast.error('Please select a date');
      return;
    }

    try {
      const res = await fetch(`/api/installations/${installationId}/holidays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHoliday),
      });

      if (res.ok) {
        toast.success('Holiday added');
        setNewHoliday({ date: '', name: '', recurring: false });
        await loadHolidays();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to add holiday');
      }
    } catch (error) {
      console.error('Failed to add holiday:', error);
      toast.error('Failed to add holiday');
    }
  }

  async function removeHoliday(date: string) {
    if (!installationId) return;

    try {
      const res = await fetch(`/api/installations/${installationId}/holidays/${date}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        toast.success('Holiday removed');
        await loadHolidays();
      } else {
        const error = await res.json();
        toast.error(error.error || 'Failed to remove holiday');
      }
    } catch (error) {
      console.error('Failed to remove holiday:', error);
      toast.error('Failed to remove holiday');
    }
  }

  const isPro = subscription.plan === 'pro';

  return (
    <>
      <AppShell.Header title="Configuration" description="Configure project settings" />

      <AppShell.Body className="p-6 space-y-6 relative">
        <PageLoadingCover loading={isLoading} pageName="Configuration" />
        {/* Work Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Work Schedule
            </CardTitle>
            <CardDescription>Select which days are working days for your team.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {DAYS.map((day, index) => (
                <div key={day} className="flex items-center gap-2">
                  <Checkbox
                    id={`day-${index}`}
                    checked={!settings.weekendDays.includes(index)}
                    onCheckedChange={() => toggleWorkDay(index)}
                  />
                  <Label htmlFor={`day-${index}`} className="cursor-pointer">
                    {day}
                  </Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* T-Shirt Sizes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TShirt className="h-5 w-5" />
              T-Shirt Size Estimates
            </CardTitle>
            <CardDescription>
              Map t-shirt sizes to working days for duration calculations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {SIZES.map((size) => (
                <div key={size} className="space-y-2">
                  <Label htmlFor={`size-${size}`}>{size}</Label>
                  <Input
                    id={`size-${size}`}
                    type="number"
                    min={1}
                    value={settings.estimateDays[size] || ''}
                    onChange={(e) => updateEstimate(size, parseInt(e.target.value) || 0)}
                  />
                  <span className="text-xs text-muted-foreground">days</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Confidence Buffers */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkle className="h-5 w-5" />
              Confidence Buffers
            </CardTitle>
            <CardDescription>
              Add buffer days based on confidence level to account for uncertainty.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 max-w-md">
              {CONFIDENCE_LEVELS.map((level) => (
                <div key={level} className="space-y-2">
                  <Label htmlFor={`conf-${level.toLowerCase()}`}>{level}</Label>
                  <Input
                    id={`conf-${level.toLowerCase()}`}
                    type="number"
                    min={0}
                    value={settings.confidenceBuffer[level] || 0}
                    onChange={(e) => updateConfidence(level, parseInt(e.target.value) || 0)}
                  />
                  <span className="text-xs text-muted-foreground">buffer days</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Holidays (Pro only) */}
        <Card className={!isPro ? 'opacity-60' : ''}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Holidays
              {!isPro && (
                <Badge variant="secondary" className="ml-2">
                  <Lock className="h-3 w-3 mr-1" />
                  Pro
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Add company holidays to exclude from schedule calculations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isPro ? (
              <>
                {/* Add Holiday Form */}
                <div className="flex flex-wrap gap-4 items-end mb-6">
                  <div className="space-y-2">
                    <Label htmlFor="holiday-date">Date</Label>
                    <Input
                      id="holiday-date"
                      type="date"
                      value={newHoliday.date}
                      onChange={(e) => setNewHoliday((h) => ({ ...h, date: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2 flex-1 min-w-[200px]">
                    <Label htmlFor="holiday-name">Name (optional)</Label>
                    <Input
                      id="holiday-name"
                      placeholder="e.g., Christmas Day"
                      value={newHoliday.name}
                      onChange={(e) => setNewHoliday((h) => ({ ...h, name: e.target.value }))}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="holiday-recurring"
                      checked={newHoliday.recurring}
                      onCheckedChange={(checked) =>
                        setNewHoliday((h) => ({ ...h, recurring: !!checked }))
                      }
                    />
                    <Label htmlFor="holiday-recurring" className="cursor-pointer">
                      Recurring yearly
                    </Label>
                  </div>
                  <Button onClick={addHoliday}>Add Holiday</Button>
                </div>

                <Separator className="my-4" />

                {/* Holiday List */}
                {holidays.length === 0 ? (
                  <p className="text-muted-foreground">No holidays configured.</p>
                ) : (
                  <div className="space-y-2">
                    {holidays.map((holiday) => (
                      <div
                        key={holiday.date}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <Calendar className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <span className="font-medium">{holiday.name || 'Holiday'}</span>
                            <span className="text-muted-foreground ml-2">
                              {new Date(holiday.date + 'T00:00:00').toLocaleDateString()}
                            </span>
                            {holiday.recurring && (
                              <Badge variant="outline" className="ml-2">
                                Recurring
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeHoliday(holiday.date)}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground mb-4">
                  Custom holidays are available on the Pro plan.
                </p>
                <Button onClick={startCheckout}>Upgrade to Pro</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sticky Save Bar */}
        {hasChanges && (
          <div className="fixed bottom-0 left-0 right-0 bg-background border-t p-4 flex justify-end gap-2 shadow-lg">
            <Button variant="outline" onClick={resetSettings}>
              Reset
            </Button>
            <Button onClick={saveSettings}>Save Changes</Button>
          </div>
        )}
      </AppShell.Body>
    </>
  );
}
