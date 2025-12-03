import { useEffect, useState, useMemo } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { DataGrid, type DataGridColumn } from '@jybrd/design-system/compounds/data-grid';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Progress } from '@jybrd/design-system/components/ui/progress';
import { Button } from '@jybrd/design-system/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import {
  Flag,
  CheckCircle,
  Warning,
  CalendarBlank,
  ArrowSquareOut
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';

interface TrackedProject {
  id: string;
  number: number;
  title: string;
  owner: string;
}

interface MilestoneItem {
  issueNumber: number;
  title: string;
  status: string;
  state: string;
  estimate: string | null;
  startDate: string | null;
  targetDate: string | null;
  duration: number;
  isCompleted: boolean;
}

interface Milestone {
  number: number;
  title: string;
  description: string | null;
  dueOn: string | null;
  state: 'OPEN' | 'CLOSED';
  url: string;
  items: MilestoneItem[];
  stats: {
    total: number;
    completed: number;
    inProgress: number;
    todo: number;
    totalDays: number;
    remainingDays: number;
  };
  latestTargetDate: string | null;
  earliestStartDate: string | null;
  isOnTrack: boolean;
  riskLevel: 'none' | 'medium' | 'high' | 'critical';
}

interface MilestoneData {
  milestones: Milestone[];
  summary: {
    total: number;
    open: number;
    closed: number;
    atRisk: number;
    unmilestoned: number;
  };
}

// Flattened row for DataGrid
interface MilestoneRow {
  id: string;
  projectNumber: number;
  projectTitle: string;
  number: number;
  title: string;
  description: string | null;
  dueOn: string | null;
  state: 'OPEN' | 'CLOSED';
  url: string;
  total: number;
  completed: number;
  inProgress: number;
  progress: number;
  remainingDays: number;
  isOnTrack: boolean;
  riskLevel: 'none' | 'medium' | 'high' | 'critical';
}

export function Milestones() {
  const { currentInstallation } = useAuth();
  const [trackedProjects, setTrackedProjects] = useState<TrackedProject[]>([]);
  const [allMilestones, setAllMilestones] = useState<MilestoneRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState({
    total: 0,
    open: 0,
    closed: 0,
    atRisk: 0,
    unmilestoned: 0
  });

  useEffect(() => {
    if (currentInstallation) {
      fetchAllMilestones();
    }
  }, [currentInstallation]);

  async function fetchAllMilestones() {
    if (!currentInstallation) return;

    setIsLoading(true);
    try {
      // First get all tracked projects
      const projectsResponse = await fetch(`/api/installations/${currentInstallation.id}/projects`);
      if (!projectsResponse.ok) {
        toast.error('Failed to load projects');
        return;
      }

      const projects = await projectsResponse.json();
      const tracked = projects.filter((p: { tracked: boolean }) => p.tracked);
      setTrackedProjects(tracked);

      // Fetch milestones from all tracked projects in parallel
      const milestonePromises = tracked.map(async (project: TrackedProject) => {
        try {
          const response = await fetch(
            `/api/installations/${currentInstallation.id}/projects/${project.number}/milestones`
          );
          if (response.ok) {
            const data: MilestoneData = await response.json();
            // Transform milestones to include project info
            return data.milestones.map((m) => ({
              id: `${project.number}-${m.number}`,
              projectNumber: project.number,
              projectTitle: project.title,
              number: m.number,
              title: m.title,
              description: m.description,
              dueOn: m.dueOn,
              state: m.state,
              url: m.url,
              total: m.stats.total,
              completed: m.stats.completed,
              inProgress: m.stats.inProgress,
              progress: m.stats.total > 0 ? Math.round((m.stats.completed / m.stats.total) * 100) : 0,
              remainingDays: m.stats.remainingDays,
              isOnTrack: m.isOnTrack,
              riskLevel: m.riskLevel,
            }));
          }
          return [];
        } catch {
          return [];
        }
      });

      const results = await Promise.all(milestonePromises);
      const flatMilestones = results.flat();
      setAllMilestones(flatMilestones);

      // Calculate summary
      const open = flatMilestones.filter(m => m.state === 'OPEN').length;
      const closed = flatMilestones.filter(m => m.state === 'CLOSED').length;
      const atRisk = flatMilestones.filter(m =>
        m.state === 'OPEN' && (m.riskLevel === 'critical' || m.riskLevel === 'high')
      ).length;

      setSummary({
        total: flatMilestones.length,
        open,
        closed,
        atRisk,
        unmilestoned: 0 // Would need separate calculation
      });
    } catch (error) {
      console.error('Failed to fetch milestones:', error);
      toast.error('Failed to load milestones');
    } finally {
      setIsLoading(false);
    }
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }

  // Define columns for milestones DataGrid
  const milestoneColumns: DataGridColumn<MilestoneRow>[] = useMemo(() => [
    {
      id: 'projectTitle',
      header: 'Project',
      accessorKey: 'projectTitle',
      width: 180,
      sortable: true,
    },
    {
      id: 'title',
      header: 'Milestone',
      accessorKey: 'title',
      width: 200,
      sortable: true,
      cell: ({ value }) => (
        <span className="font-medium">{value}</span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      accessorKey: 'state',
      width: 100,
      cell: ({ value }) => {
        const state = value as MilestoneRow['state'];
        if (state === 'CLOSED') {
          return (
            <Badge variant="secondary">
              <CheckCircle className="h-3 w-3 mr-1" weight="fill" />
              Closed
            </Badge>
          );
        }
        return (
          <Badge variant="default">
            <Flag className="h-3 w-3 mr-1" weight="fill" />
            Open
          </Badge>
        );
      },
    },
    {
      id: 'riskLevel',
      header: 'Status',
      accessorKey: 'riskLevel',
      width: 100,
      cell: ({ row }) => {
        if (row.state === 'CLOSED') {
          return <span className="text-muted-foreground">-</span>;
        }
        const level = row.riskLevel;
        if (level === 'critical') {
          return (
            <Badge className="bg-red-500">Past Due</Badge>
          );
        }
        if (level === 'high') {
          return (
            <Badge className="bg-orange-500">Off Track</Badge>
          );
        }
        if (level === 'medium') {
          return (
            <Badge className="bg-yellow-500">At Risk</Badge>
          );
        }
        return (
          <Badge className="bg-green-500">On Track</Badge>
        );
      },
    },
    {
      id: 'dueOn',
      header: 'Due Date',
      accessorKey: 'dueOn',
      width: 120,
      sortable: true,
      cell: ({ value }) => (
        <div className="flex items-center gap-1">
          <CalendarBlank className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm">{formatDate(value)}</span>
        </div>
      ),
    },
    {
      id: 'completed',
      header: 'Issues',
      accessorKey: 'completed',
      width: 80,
      sortable: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.completed}/{row.total}</span>
      ),
    },
    {
      id: 'progress',
      header: 'Progress',
      accessorKey: 'progress',
      width: 150,
      sortable: true,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Progress value={row.progress} className="h-2 w-20" />
          <span className="text-sm text-muted-foreground">{row.progress}%</span>
        </div>
      ),
    },
    {
      id: 'remainingDays',
      header: 'Days Left',
      accessorKey: 'remainingDays',
      width: 90,
      sortable: true,
      cell: ({ value, row }) => {
        if (row.state === 'CLOSED') {
          return <span className="text-muted-foreground">-</span>;
        }
        return (
          <span className={`text-sm ${value < 0 ? 'text-destructive font-medium' : ''}`}>
            {value}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      accessorKey: 'url',
      width: 60,
      cell: ({ row }) => (
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          <Button variant="ghost" size="sm">
            <ArrowSquareOut className="h-4 w-4" />
          </Button>
        </a>
      ),
    },
  ], []);

  // Group config for DataGrid
  const groupConfig = useMemo(() => [
    { field: 'projectTitle', label: 'Project' },
    { field: 'state', label: 'State' },
    { field: 'riskLevel', label: 'Status' },
  ], []);

  return (
    <>
      <AppShell.Header
        title="Milestones"
        description="Track releases and milestones across all projects"
      />

      <AppShell.Body className="p-6 relative">
        <PageLoadingCover loading={isLoading} pageName="Milestones" />
        {trackedProjects.length === 0 && !isLoading ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Flag className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Projects Tracked</h3>
              <p className="text-muted-foreground">
                Track a GitHub Project to view its milestones here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Milestones
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {summary.total}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Flag className="h-4 w-4 text-blue-500" weight="fill" />
                    Open
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">
                    {summary.open}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-500" weight="fill" />
                    Closed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {summary.closed}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Warning className="h-4 w-4 text-orange-500" weight="fill" />
                    At Risk
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">
                    {summary.atRisk}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Projects
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {trackedProjects.length}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Milestones DataGrid */}
            <Card>
              <CardContent className="pt-6">
                {allMilestones.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No milestones found. Create milestones in GitHub to track releases.
                  </p>
                ) : (
                  <DataGrid
                    columns={milestoneColumns}
                    data={allMilestones}
                    enableSorting
                    enableGrouping
                    groupBy="projectTitle"
                    groupConfig={groupConfig}
                    enableColumnChooser
                    enableColumnResizing
                    enableExport
                    exportFilename="milestones"
                    getRowId={(row) => row.id}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </AppShell.Body>
    </>
  );
}
