import { useEffect, useState, useMemo } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { DataGrid, type DataGridColumn } from '@jybrd/design-system/compounds/data-grid';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Progress } from '@jybrd/design-system/components/ui/progress';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@jybrd/design-system/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import {
  Users,
  Warning,
  CheckCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';

interface TrackedProject {
  id: string;
  number: number;
  title: string;
  owner: string;
}

interface ResourceItem {
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

interface Resource {
  login: string;
  name: string;
  avatarUrl: string;
  items: ResourceItem[];
  totalItems: number;
  completedItems: number;
  totalDays: number;
  remainingDays: number;
  workload: 'low' | 'normal' | 'high' | 'overloaded';
  projects?: Array<{
    number: number;
    title: string;
    items: number;
    remainingDays: number;
  }>;
}

interface ResourceData {
  resources: Resource[];
  summary: {
    totalAssignees: number;
    unassignedItems: number;
    byWorkload: {
      overloaded: number;
      high: number;
      normal: number;
      low: number;
    };
  };
}

// Flattened row for DataGrid
interface ResourceRow {
  id: string;
  login: string;
  name: string;
  avatarUrl: string;
  totalItems: number;
  completedItems: number;
  openItems: number;
  progress: number;
  totalDays: number;
  remainingDays: number;
  workload: 'low' | 'normal' | 'high' | 'overloaded';
  projectCount: number;
  projectNames: string;
}

export function Resources() {
  const { currentInstallation } = useAuth();
  const [trackedProjects, setTrackedProjects] = useState<TrackedProject[]>([]);
  const [resourceData, setResourceData] = useState<ResourceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (currentInstallation) {
      fetchResources();
    }
  }, [currentInstallation]);

  async function fetchResources() {
    if (!currentInstallation) return;

    setIsLoading(true);
    try {
      const [projectsRes, resourcesRes] = await Promise.all([
        fetch(`/api/installations/${currentInstallation.id}/projects`),
        fetch(`/api/installations/${currentInstallation.id}/resources/summary`)
      ]);

      if (projectsRes.ok) {
        const projects = await projectsRes.json();
        const tracked = projects.filter((p: { tracked: boolean }) => p.tracked);
        setTrackedProjects(tracked);
      }

      if (resourcesRes.ok) {
        const data = await resourcesRes.json();
        setResourceData(data);
      } else {
        toast.error('Failed to load resource data');
      }
    } catch (error) {
      console.error('Failed to fetch resources:', error);
      toast.error('Failed to load resource data');
    } finally {
      setIsLoading(false);
    }
  }

  // Transform resources to DataGrid rows
  const resourceRows: ResourceRow[] = useMemo(() => {
    if (!resourceData) return [];

    return resourceData.resources.map((r) => ({
      id: r.login,
      login: r.login,
      name: r.name,
      avatarUrl: r.avatarUrl,
      totalItems: r.totalItems,
      completedItems: r.completedItems,
      openItems: r.totalItems - r.completedItems,
      progress: r.totalItems > 0 ? Math.round((r.completedItems / r.totalItems) * 100) : 0,
      totalDays: r.totalDays,
      remainingDays: r.remainingDays,
      workload: r.workload,
      projectCount: r.projects?.length || 0,
      projectNames: r.projects?.map(p => p.title).join(', ') || '',
    }));
  }, [resourceData]);

  function getWorkloadColor(workload: string): string {
    switch (workload) {
      case 'overloaded': return 'bg-red-500';
      case 'high': return 'bg-orange-500';
      case 'normal': return 'bg-green-500';
      case 'low': return 'bg-slate-400';
      default: return '';
    }
  }

  function getWorkloadLabel(workload: string): string {
    switch (workload) {
      case 'overloaded': return 'Overloaded';
      case 'high': return 'High';
      case 'normal': return 'Normal';
      case 'low': return 'Available';
      default: return workload;
    }
  }

  // Define columns for resources DataGrid
  const resourceColumns: DataGridColumn<ResourceRow>[] = useMemo(() => [
    {
      id: 'name',
      header: 'Team Member',
      accessorKey: 'name',
      width: 200,
      sortable: true,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Avatar className="h-7 w-7">
            <AvatarImage src={row.avatarUrl} alt={row.name} />
            <AvatarFallback>
              {row.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="font-medium truncate">{row.name}</div>
            <div className="text-xs text-muted-foreground">@{row.login}</div>
          </div>
        </div>
      ),
    },
    {
      id: 'workload',
      header: 'Workload',
      accessorKey: 'workload',
      width: 110,
      cell: ({ value }) => {
        const workload = value as ResourceRow['workload'];
        return (
          <Badge className={getWorkloadColor(workload)}>
            {getWorkloadLabel(workload)}
          </Badge>
        );
      },
    },
    {
      id: 'openItems',
      header: 'Open Items',
      accessorKey: 'openItems',
      width: 100,
      sortable: true,
      cell: ({ value }) => (
        <span className={`text-sm font-medium ${value > 5 ? 'text-orange-600' : ''}`}>
          {value}
        </span>
      ),
    },
    {
      id: 'completedItems',
      header: 'Completed',
      accessorKey: 'completedItems',
      width: 100,
      sortable: true,
      cell: ({ row }) => (
        <span className="text-sm">{row.completedItems}/{row.totalItems}</span>
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
      header: 'Days Remaining',
      accessorKey: 'remainingDays',
      width: 120,
      sortable: true,
      cell: ({ value }) => (
        <span className={`text-sm ${value > 50 ? 'text-orange-600 font-medium' : ''}`}>
          {value}
        </span>
      ),
    },
    {
      id: 'projectCount',
      header: 'Projects',
      accessorKey: 'projectCount',
      width: 80,
      sortable: true,
      cell: ({ value }) => (
        <span className="text-sm">{value}</span>
      ),
    },
    {
      id: 'projectNames',
      header: 'Assigned Projects',
      accessorKey: 'projectNames',
      width: 200,
      cell: ({ value }) => (
        <span className="text-sm text-muted-foreground truncate block max-w-[180px]" title={value}>
          {value || '-'}
        </span>
      ),
    },
  ], []);

  // Group config for DataGrid
  const groupConfig = useMemo(() => [
    { field: 'workload', label: 'Workload' },
  ], []);

  return (
    <>
      <AppShell.Header
        title="Resources"
        description="View team workload and capacity allocation across all projects"
      />

      <AppShell.Body className="p-6 relative">
        <PageLoadingCover loading={isLoading} pageName="Resources" />
        {trackedProjects.length === 0 && !isLoading ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Projects Tracked</h3>
              <p className="text-muted-foreground">
                Track a GitHub Project to see team allocation.
              </p>
            </CardContent>
          </Card>
        ) : !resourceData ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No resource data available.
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
                    Team Members
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {resourceData.summary.totalAssignees}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Warning className="h-4 w-4 text-red-500" weight="fill" />
                    Overloaded
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">
                    {resourceData.summary.byWorkload.overloaded}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Warning className="h-4 w-4 text-orange-500" weight="fill" />
                    High Load
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">
                    {resourceData.summary.byWorkload.high}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-500" weight="fill" />
                    Available
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {resourceData.summary.byWorkload.low}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Unassigned Items
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {resourceData.summary.unassignedItems}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Resources DataGrid */}
            <Card>
              <CardContent className="pt-6">
                {resourceRows.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No assigned items found. Assign team members to issues to see allocation.
                  </p>
                ) : (
                  <DataGrid
                    columns={resourceColumns}
                    data={resourceRows}
                    enableSorting
                    enableGrouping
                    groupConfig={groupConfig}
                    enableColumnChooser
                    enableColumnResizing
                    enableExport
                    exportFilename="resources"
                    getRowId={(row) => row.id}
                  />
                )}
              </CardContent>
            </Card>

            {/* Workload Legend */}
            <Card>
              <CardHeader>
                <CardTitle>Workload Levels</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge className={getWorkloadColor('overloaded')}>Overloaded</Badge>
                    <span className="text-muted-foreground">&gt;75 days or &gt;7 items</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getWorkloadColor('high')}>High</Badge>
                    <span className="text-muted-foreground">50-75 days or 5-7 items</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getWorkloadColor('normal')}>Normal</Badge>
                    <span className="text-muted-foreground">15-50 days or 2-5 items</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={getWorkloadColor('low')}>Available</Badge>
                    <span className="text-muted-foreground">&lt;15 days or &lt;2 items</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </AppShell.Body>
    </>
  );
}
