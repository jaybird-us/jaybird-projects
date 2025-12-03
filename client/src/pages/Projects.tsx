import { useEffect, useState, useMemo } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { DataGrid, type DataGridColumn } from '@jybrd/design-system/compounds/data-grid';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@jybrd/design-system/components/ui/button';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Progress } from '@jybrd/design-system/components/ui/progress';
import { useAuth } from '@/contexts/AuthContext';
import {
  Calendar,
  ArrowSquareOut,
  Warning,
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

// Combined type for DataGrid rows
interface ProjectRow {
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
  // From executive summary (only for tracked projects)
  total: number;
  completed: number;
  remaining: number;
  progress: number;
  atRisk: number;
  behind: number;
  health: 'good' | 'warning' | 'critical' | 'none';
  trackingStatus: 'Tracked' | 'Not Tracked';
}

export function Projects() {
  const { currentInstallation } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [executiveSummary, setExecutiveSummary] = useState<ExecutiveSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [trackingProject, setTrackingProject] = useState<number | null>(null);

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
      console.error('Failed to fetch projects:', error);
      toast.error('Failed to load projects');
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

  // Filter out closed projects, include both tracked and untracked
  const activeProjects = projects.filter((p) => !p.closed);
  const trackedProjects = activeProjects.filter((p) => p.tracked);

  // Merge project data with executive summary data for DataGrid
  const projectRows: ProjectRow[] = useMemo(() => {
    return activeProjects.map((project) => {
      const details = project.tracked
        ? executiveSummary?.projectDetails.find((d) => d.number === project.number)
        : null;
      return {
        ...project,
        total: details?.items.total ?? project.itemCount,
        completed: details?.items.completed ?? 0,
        remaining: details?.items.remaining ?? project.itemCount,
        progress: details ? Math.round((details.items.completed / Math.max(details.items.total, 1)) * 100) : 0,
        atRisk: details ? details.risks.critical + details.risks.high : 0,
        behind: details?.timeline.behind ?? 0,
        health: project.tracked ? (details?.health ?? 'good') : 'none',
        trackingStatus: project.tracked ? 'Tracked' : 'Not Tracked',
      };
    });
  }, [activeProjects, executiveSummary]);

  // Define columns for projects DataGrid
  const projectColumns: DataGridColumn<ProjectRow>[] = useMemo(() => [
    {
      id: 'title',
      header: 'Project',
      accessorKey: 'title',
      width: 250,
      sortable: true,
      cell: ({ row }) => (
        row.tracked ? (
          <Link to={`/app/projects/${row.number}`} className="hover:underline">
            <span className="font-medium">{row.title}</span>
          </Link>
        ) : (
          <span className="font-medium">{row.title}</span>
        )
      ),
    },
    {
      id: 'owner',
      header: 'Owner',
      accessorKey: 'owner',
      width: 150,
      sortable: true,
    },
    {
      id: 'trackingStatus',
      header: 'Status',
      accessorKey: 'trackingStatus',
      width: 110,
      cell: ({ row }) => (
        row.tracked ? (
          <Badge variant="default" className="bg-blue-500">
            <CheckCircle className="h-3 w-3 mr-1" weight="fill" />
            Tracked
          </Badge>
        ) : (
          <Badge variant="secondary">
            Not Tracked
          </Badge>
        )
      ),
    },
    {
      id: 'total',
      header: 'Items',
      accessorKey: 'total',
      width: 80,
      sortable: true,
      hidden: true,
      cell: ({ value }) => <span className="text-sm">{value}</span>,
    },
    {
      id: 'completed',
      header: 'Completed',
      accessorKey: 'completed',
      width: 100,
      sortable: true,
      hidden: true,
      cell: ({ row }) => (
        row.tracked ? (
          <span className="text-sm">{row.completed}/{row.total}</span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
    },
    {
      id: 'progress',
      header: 'Progress',
      accessorKey: 'progress',
      width: 150,
      sortable: true,
      cell: ({ row }) => (
        row.tracked ? (
          <div className="flex items-center gap-2">
            <Progress value={row.progress} className="h-2 w-20" />
            <span className="text-sm text-muted-foreground">{row.progress}%</span>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
    },
    {
      id: 'atRisk',
      header: 'At Risk',
      accessorKey: 'atRisk',
      width: 80,
      sortable: true,
      hidden: true,
      cell: ({ value, row }) => (
        row.tracked ? (
          <span className={`text-sm ${value > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
            {value}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
    },
    {
      id: 'behind',
      header: 'Behind',
      accessorKey: 'behind',
      width: 80,
      sortable: true,
      hidden: true,
      cell: ({ value, row }) => (
        row.tracked ? (
          <span className={`text-sm ${value > 0 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
            {value}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
    },
    {
      id: 'health',
      header: 'Health',
      accessorKey: 'health',
      width: 120,
      cell: ({ row }) => {
        if (!row.tracked) {
          return <span className="text-sm text-muted-foreground">-</span>;
        }
        const health = row.health;
        if (health === 'good') {
          return (
            <Badge variant="default" className="bg-green-500">
              <CheckCircle className="h-3 w-3 mr-1" weight="fill" />
              Healthy
            </Badge>
          );
        }
        if (health === 'warning') {
          return (
            <Badge variant="default" className="bg-yellow-500">
              <Warning className="h-3 w-3 mr-1" weight="fill" />
              Warning
            </Badge>
          );
        }
        return (
          <Badge variant="destructive">
            <Warning className="h-3 w-3 mr-1" weight="fill" />
            At Risk
          </Badge>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      accessorKey: 'url',
      width: 120,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {!row.tracked && (
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                trackProject(row.number);
              }}
              disabled={trackingProject === row.number}
            >
              {trackingProject === row.number ? 'Tracking...' : 'Track'}
            </Button>
          )}
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
        </div>
      ),
    },
  ], [trackingProject]);

  // Group config for DataGrid
  const groupConfig = useMemo(() => [
    { field: 'trackingStatus', label: 'Status' },
    { field: 'owner', label: 'Owner' },
  ], []);

  return (
    <>
      <AppShell.Header
        title="Projects"
        description="Manage your tracked GitHub Projects"
      />

      <AppShell.Body className="p-6 relative">
        <PageLoadingCover loading={isLoading} pageName="Projects" />
        {projectRows.length === 0 && !isLoading ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Projects Found</h3>
              <p className="text-muted-foreground">
                No GitHub Projects are accessible by this installation.
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
                    Total Projects
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{projectRows.length}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-blue-500" weight="fill" />
                    Tracked
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600">
                    {trackedProjects.length}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-500" weight="fill" />
                    Healthy
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {projectRows.filter(p => p.health === 'good').length}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Warning className="h-4 w-4 text-yellow-500" weight="fill" />
                    Warning
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600">
                    {projectRows.filter(p => p.health === 'warning').length}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Warning className="h-4 w-4 text-red-500" weight="fill" />
                    At Risk
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    {projectRows.filter(p => p.health === 'critical').length}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Projects DataGrid */}
            <Card>
              <CardContent className="pt-6">
                <DataGrid
                  columns={projectColumns}
                  data={projectRows}
                  enableSorting
                  enableGrouping
                  groupConfig={groupConfig}
                  enableColumnChooser
                  enableColumnResizing
                  enableExport
                  exportFilename="projects"
                  getRowId={(row) => row.id}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </AppShell.Body>
    </>
  );
}
