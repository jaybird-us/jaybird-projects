import { useEffect, useState } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@jybrd/design-system/components/ui/button';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Progress } from '@jybrd/design-system/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import {
  Calendar,
  ListChecks,
  ArrowRight,
  Check,
  Circle,
  Warning,
  WarningCircle,
  Heartbeat,
  Download,
  TrendUp,
  CheckCircle
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';

interface Project {
  id: string;
  number: number;
  title: string;
  description?: string;
  url: string;
  owner: string;
  ownerType: string;
  itemCount: number;
  tracked: boolean;
  trackedIssues: number;
  closed: boolean;
  updatedAt: string;
}

interface ExecutiveSummary {
  projects: {
    total: number;
    tracked: number;
  };
  items: {
    total: number;
    byStatus: {
      todo: number;
      inProgress: number;
      done: number;
      other: number;
    };
    completed: number;
    remaining: number;
  };
  risks: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    itemsAtRisk: number;
  };
  timeline: {
    onTrack: number;
    behind: number;
    ahead: number;
    noBaseline: number;
  };
  healthScore: number;
  projectDetails: Array<{
    number: number;
    title: string;
    owner: string;
    items: { total: number; completed: number; remaining: number };
    risks: { critical: number; high: number; medium: number; low: number };
    timeline: { onTrack: number; behind: number; ahead: number };
    health: 'good' | 'warning' | 'critical';
    error?: string;
  }>;
}

export function Dashboard() {
  const { currentInstallation } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [trackingProject, setTrackingProject] = useState<number | null>(null);
  const [executiveSummary, setExecutiveSummary] = useState<ExecutiveSummary | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (currentInstallation) {
      fetchAllData();
    }
  }, [currentInstallation]);

  async function fetchAllData() {
    if (!currentInstallation) return;

    setIsLoading(true);
    try {
      const [projectsRes, summaryRes] = await Promise.all([
        fetch(`/api/installations/${currentInstallation.id}/projects`),
        fetch(`/api/installations/${currentInstallation.id}/executive-summary`)
      ]);

      if (projectsRes.ok) {
        const data = await projectsRes.json();
        setProjects(data);
      }

      if (summaryRes.ok) {
        const data = await summaryRes.json();
        setExecutiveSummary(data);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      toast.error('Failed to load dashboard');
    } finally {
      setIsLoading(false);
    }
  }

  async function trackProject(projectNumber: number) {
    if (!currentInstallation) return;

    setTrackingProject(projectNumber);
    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/projects/${projectNumber}/track`,
        { method: 'POST' }
      );

      if (response.ok) {
        toast.success('Project is now being tracked');
        await fetchAllData();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to track project');
      }
    } catch (error) {
      console.error('Failed to track project:', error);
      toast.error('Failed to track project');
    } finally {
      setTrackingProject(null);
    }
  }

  async function exportSummary() {
    if (!currentInstallation) return;

    setIsExporting(true);
    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/executive-summary/export?format=csv`
      );
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `executive-summary-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success('Report exported successfully');
      } else {
        toast.error('Failed to export report');
      }
    } catch (error) {
      console.error('Failed to export:', error);
      toast.error('Failed to export report');
    } finally {
      setIsExporting(false);
    }
  }

  function getHealthColor(score: number): string {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  }

  function getHealthBg(health: string): string {
    if (health === 'good') return 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800';
    if (health === 'warning') return 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800';
    return 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800';
  }

  const trackedProjects = projects.filter((p) => p.tracked);
  const openProjects = projects.filter((p) => !p.closed);

  return (
    <>
      <AppShell.Header title="Dashboard" description="Overview of your GitHub Projects">
        {executiveSummary && (
          <Button
            variant="outline"
            size="sm"
            onClick={exportSummary}
            disabled={isExporting}
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        )}
      </AppShell.Header>

      <AppShell.Body className="p-6 relative">
        <PageLoadingCover loading={isLoading} pageName="Dashboard" />
        {!isLoading && (
          <>
        {/* Executive Summary Section */}
        {executiveSummary && trackedProjects.length > 0 && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4">Portfolio Overview</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Health Score */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Heartbeat className="h-4 w-4" />
                    Health Score
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-3xl font-bold ${getHealthColor(executiveSummary.healthScore)}`}>
                    {executiveSummary.healthScore}
                  </div>
                  <Progress value={executiveSummary.healthScore} className="mt-2 h-1" />
                </CardContent>
              </Card>

              {/* Total Items */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <ListChecks className="h-4 w-4" />
                    Total Items
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{executiveSummary.items.total}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {executiveSummary.items.completed} completed
                  </p>
                </CardContent>
              </Card>

              {/* At Risk */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Warning className="h-4 w-4" />
                    At Risk
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-destructive">
                    {executiveSummary.risks.itemsAtRisk}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {executiveSummary.risks.critical > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {executiveSummary.risks.critical} critical
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* On Track */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <TrendUp className="h-4 w-4" />
                    On Track
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600">
                    {executiveSummary.timeline.onTrack + executiveSummary.timeline.ahead}
                  </div>
                  {executiveSummary.timeline.behind > 0 && (
                    <Badge variant="destructive" className="text-xs mt-1">
                      {executiveSummary.timeline.behind} behind
                    </Badge>
                  )}
                </CardContent>
              </Card>

              {/* Progress */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Progress
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {executiveSummary.items.total > 0
                      ? Math.round((executiveSummary.items.completed / executiveSummary.items.total) * 100)
                      : 0}%
                  </div>
                  <Progress
                    value={executiveSummary.items.total > 0
                      ? (executiveSummary.items.completed / executiveSummary.items.total) * 100
                      : 0}
                    className="mt-2 h-1"
                  />
                </CardContent>
              </Card>
            </div>

            {/* Project Health Cards */}
            {executiveSummary.projectDetails.length > 0 && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {executiveSummary.projectDetails.map((project) => (
                  <div
                    key={project.number}
                    className={`p-3 border rounded-lg ${getHealthBg(project.health)}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {project.health === 'good' ? (
                          <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" weight="fill" />
                        ) : project.health === 'warning' ? (
                          <Warning className="h-4 w-4 text-yellow-500 flex-shrink-0" weight="fill" />
                        ) : (
                          <Warning className="h-4 w-4 text-red-500 flex-shrink-0" weight="fill" />
                        )}
                        <span className="font-medium truncate text-sm">{project.title}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{project.items.completed}/{project.items.total}</span>
                        {project.risks.critical > 0 && (
                          <Badge variant="destructive" className="text-xs px-1">
                            {project.risks.critical}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Available Projects
              </CardTitle>
              <Calendar className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{openProjects.length}</div>
              <p className="text-xs text-muted-foreground">
                {trackedProjects.length} tracked
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Tracked Projects
              </CardTitle>
              <ListChecks className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{trackedProjects.length}</div>
              <p className="text-xs text-muted-foreground">
                being monitored
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Items
              </CardTitle>
              <ListChecks className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {projects.reduce((sum, p) => sum + (p.itemCount || 0), 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                in all GitHub Projects
              </p>
            </CardContent>
          </Card>

          {/* Risk Summary Card */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Risk Status
              </CardTitle>
              <Warning className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {executiveSummary ? (
                <>
                  <div className="text-2xl font-bold flex items-center gap-2">
                    {executiveSummary.risks.itemsAtRisk}
                    {executiveSummary.risks.itemsAtRisk > 0 && (
                      <WarningCircle className="h-5 w-5 text-destructive" weight="fill" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    items at risk
                  </p>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">Loading...</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Projects List */}
        <Card>
          <CardHeader>
            <CardTitle>GitHub Projects</CardTitle>
            <CardDescription>
              All projects from {currentInstallation?.account.login}. Click to track a project with jayBird.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  No GitHub Projects found. Create a project in GitHub to get started.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className={`flex items-center justify-between p-4 border rounded-lg transition-colors ${
                      project.closed ? 'opacity-50' : 'hover:bg-accent/50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Tracking indicator */}
                      <div className="flex-shrink-0">
                        {project.tracked ? (
                          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                            <Check className="h-4 w-4 text-primary" weight="bold" />
                          </div>
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                            <Circle className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Project info */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium truncate">{project.title}</h3>
                          {project.tracked && (
                            <Badge variant="secondary" className="flex-shrink-0">
                              Tracked
                            </Badge>
                          )}
                          {project.closed && (
                            <Badge variant="outline" className="flex-shrink-0">
                              Closed
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">
                          {project.itemCount} items
                          {project.tracked && project.trackedIssues > 0 && (
                            <> &middot; {project.trackedIssues} tracked</>
                          )}
                          {project.description && <> &middot; {project.description}</>}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                      {project.tracked ? (
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/app/projects/${project.number}`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => trackProject(project.number)}
                          disabled={trackingProject === project.number || project.closed}
                        >
                          {trackingProject === project.number ? 'Tracking...' : 'Track'}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
          </>
        )}
      </AppShell.Body>
    </>
  );
}
