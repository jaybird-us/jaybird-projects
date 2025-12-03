import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Lock } from '@phosphor-icons/react';

export function Analytics() {
  return (
    <>
      <AppShell.Header title="Analytics" description="Track project performance and variance" />

      <AppShell.Body className="p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Coming Soon
              <Badge variant="secondary">
                <Lock className="h-3 w-3 mr-1" />
                Pro
              </Badge>
            </CardTitle>
            <CardDescription>
              Variance reports and analytics are coming soon for Pro subscribers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Analytics will include:
            </p>
            <ul className="list-disc list-inside mt-4 space-y-2 text-sm">
              <li>Baseline vs actual schedule comparison</li>
              <li>Schedule variance tracking over time</li>
              <li>Estimate accuracy reports</li>
              <li>Team velocity insights</li>
            </ul>
          </CardContent>
        </Card>
      </AppShell.Body>
    </>
  );
}
