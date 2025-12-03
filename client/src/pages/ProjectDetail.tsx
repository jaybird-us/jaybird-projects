import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { RecordDetailHighlights } from '@jybrd/design-system/compounds/record-detail';
import { TabbedContainer } from '@jybrd/design-system/compounds/tabbed-container';
import { DataGrid, type DataGridColumn } from '@jybrd/design-system/compounds/data-grid';
import { ActivityTimeline, type TimelineItem } from '@jybrd/design-system/compounds/timeline';
import { Button } from '@jybrd/design-system/components/ui/button';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Progress } from '@jybrd/design-system/components/ui/progress';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@jybrd/design-system/components/ui/resizable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@jybrd/design-system/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@jybrd/design-system/components/ui/select';
import { Label } from '@jybrd/design-system/components/ui/label';
import { Input } from '@jybrd/design-system/components/ui/input';
import { Textarea } from '@jybrd/design-system/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkdownEditor } from '@/components/ui/markdown-editor';
import { useAuth } from '@/contexts/AuthContext';
import {
  ArrowLeft,
  Warning,
  CheckCircle,
  ArrowSquareOut,
  ChatText,
  Plus,
  Bug,
  Lightbulb,
  CheckSquare,
  Article,
  User,
  Stack,
  GitCommit,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';

interface Project {
  id: string;
  number: number;
  title: string;
  description?: string;
  url: string;
  owner: string;
}

interface ProjectMetrics {
  items: { total: number; completed: number; remaining: number };
  risks: { critical: number; high: number; medium: number; low: number };
  timeline: { onTrack: number; behind: number; ahead: number };
  health: 'good' | 'warning' | 'critical';
}

interface StatusUpdate {
  id: string;
  body: string;
  bodyHTML: string;
  status: 'INACTIVE' | 'ON_TRACK' | 'AT_RISK' | 'OFF_TRACK' | 'COMPLETE';
  createdAt: string;
  creator?: {
    login: string;
    avatarUrl: string;
  };
}

interface Assignee {
  login: string;
  name: string;
  avatarUrl: string;
}

interface ProjectItem {
  id: string;
  issueNumber: number;
  type: 'bug' | 'feature' | 'task' | 'story' | 'epic';
  title: string;
  url: string;
  state: string;
  assignees: Assignee[];
  status: string;
  estimate?: string;
  startDate?: string;
  targetDate?: string;
  actualEndDate?: string;
  percentComplete: number;
  milestone: string;
  milestoneNumber?: number;
  labels: { name: string; color: string }[];
}

interface Risk {
  id: number;
  title: string;
  description?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'mitigated' | 'closed';
  owner?: string;
  created_at: string;
  updated_at?: string;
}

interface Commit {
  sha: string;
  shortSha: string;
  message: string;
  author: {
    login: string;
    name: string;
    avatarUrl?: string;
  };
  date: string;
  url: string;
  repository: string;
}

// Status configuration with colors and descriptions
const STATUS_CONFIG = {
  INACTIVE: {
    label: 'Inactive',
    description: 'This project is inactive.',
    color: 'bg-gray-400',
  },
  ON_TRACK: {
    label: 'On Track',
    description: 'This project is on track with no risks.',
    color: 'bg-green-500',
  },
  AT_RISK: {
    label: 'At Risk',
    description: 'This project is at risk and encountering some challenges.',
    color: 'bg-amber-500',
  },
  OFF_TRACK: {
    label: 'Off Track',
    description: 'This project is off track and needs attention.',
    color: 'bg-red-500',
  },
  COMPLETE: {
    label: 'Complete',
    description: 'This project is complete.',
    color: 'bg-purple-500',
  },
} as const;

// Item type configuration for icons and colors
const ITEM_TYPE_CONFIG = {
  epic: { icon: Stack, color: 'text-orange-500', label: 'Epic' },
  bug: { icon: Bug, color: 'text-red-500', label: 'Bug' },
  feature: { icon: Lightbulb, color: 'text-purple-500', label: 'Feature' },
  task: { icon: CheckSquare, color: 'text-blue-500', label: 'Task' },
  story: { icon: Article, color: 'text-green-500', label: 'Story' },
} as const;

// Item status configuration - maps status strings to badge variants
function getItemStatusVariant(status: string): 'default' | 'secondary' | 'outline' | 'destructive' {
  const statusLower = status.toLowerCase();
  if (statusLower === 'done' || statusLower === 'closed' || statusLower === 'complete') {
    return 'outline';
  }
  if (statusLower === 'in progress' || statusLower === 'in_progress') {
    return 'default';
  }
  if (statusLower === 'blocked') {
    return 'destructive';
  }
  return 'secondary';
}

export function ProjectDetail() {
  const { projectNumber } = useParams<{ projectNumber: string }>();
  const { currentInstallation, isLoading: authLoading } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [statusUpdate, setStatusUpdate] = useState<StatusUpdate | null>(null);
  const [projectItems, setProjectItems] = useState<ProjectItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);

  // Status update dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newStatus, setNewStatus] = useState<keyof typeof STATUS_CONFIG>('ON_TRACK');
  const [newBody, setNewBody] = useState('');

  // Risks state
  const [risks, setRisks] = useState<Risk[]>([]);
  const [, setRisksLoading] = useState(false);
  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [isCreatingRisk, setIsCreatingRisk] = useState(false);
  const [newRiskTitle, setNewRiskTitle] = useState('');
  const [newRiskDescription, setNewRiskDescription] = useState('');
  const [newRiskSeverity, setNewRiskSeverity] = useState<Risk['severity']>('medium');
  const [newRiskOwner, setNewRiskOwner] = useState('');

  // Commits state
  const [commits, setCommits] = useState<Commit[]>([]);

  useEffect(() => {
    if (authLoading) return; // Wait for auth to complete

    if (currentInstallation && projectNumber) {
      fetchData();
    } else {
      // Auth done but no installation - stop loading
      setIsLoading(false);
    }
  }, [currentInstallation, projectNumber, authLoading]);

  async function fetchData() {
    if (!currentInstallation || !projectNumber) return;

    setIsLoading(true);
    setItemsLoading(true);
    setRisksLoading(true);
    try {
      // Fetch project info, metrics, status updates, items, risks, and commits in parallel
      const [projectsRes, summaryRes, statusRes, itemsRes, risksRes, commitsRes] = await Promise.all([
        fetch(`/api/installations/${currentInstallation.id}/projects`),
        fetch(`/api/installations/${currentInstallation.id}/executive-summary`),
        fetch(`/api/installations/${currentInstallation.id}/projects/${projectNumber}/status-updates`).catch(() => null),
        fetch(`/api/installations/${currentInstallation.id}/projects/${projectNumber}/items`).catch(() => null),
        fetch(`/api/installations/${currentInstallation.id}/projects/${projectNumber}/project-risks`).catch(() => null),
        fetch(`/api/installations/${currentInstallation.id}/projects/${projectNumber}/commits`).catch(() => null)
      ]);

      if (projectsRes.ok) {
        const projects = await projectsRes.json();
        const projectData = projects.find(
          (p: Project) => p.number === parseInt(projectNumber)
        );
        if (projectData) {
          setProject(projectData);
        }
      }

      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        const projectMetrics = summary.projectDetails?.find(
          (p: { number: number }) => p.number === parseInt(projectNumber)
        );
        if (projectMetrics) {
          setMetrics({
            items: projectMetrics.items,
            risks: projectMetrics.risks,
            timeline: projectMetrics.timeline,
            health: projectMetrics.health
          });
        }
      }

      if (statusRes?.ok) {
        const statusData = await statusRes.json();
        if (statusData.length > 0) {
          setStatusUpdate(statusData[0]);
        }
      }

      if (itemsRes?.ok) {
        const itemsData = await itemsRes.json();
        setProjectItems(itemsData);
      }

      if (risksRes?.ok) {
        const risksData = await risksRes.json();
        setRisks(risksData.risks || []);
      }

      if (commitsRes?.ok) {
        const commitsData = await commitsRes.json();
        setCommits(commitsData.commits || []);
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
      toast.error('Failed to load project');
    } finally {
      setIsLoading(false);
      setItemsLoading(false);
      setRisksLoading(false);
    }
  }

  function getHealthBadge(health: string) {
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
          Needs Attention
        </Badge>
      );
    }
    return (
      <Badge variant="destructive">
        <Warning className="h-3 w-3 mr-1" weight="fill" />
        At Risk
      </Badge>
    );
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'ON_TRACK':
        return <Badge className="bg-green-500">On Track</Badge>;
      case 'AT_RISK':
        return <Badge className="bg-amber-500">At Risk</Badge>;
      case 'OFF_TRACK':
        return <Badge className="bg-red-500">Off Track</Badge>;
      case 'COMPLETE':
        return <Badge className="bg-purple-500">Complete</Badge>;
      default:
        return <Badge variant="secondary">Inactive</Badge>;
    }
  }

  async function handleCreateStatusUpdate() {
    if (!currentInstallation || !projectNumber || !newBody.trim()) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/projects/${projectNumber}/status-updates`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            body: newBody.trim(),
            status: newStatus
          })
        }
      );

      if (response.ok) {
        const created = await response.json();
        setStatusUpdate(created);
        setDialogOpen(false);
        setNewBody('');
        setNewStatus('ON_TRACK');
        toast.success('Status update created');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to create status update');
      }
    } catch (error) {
      console.error('Failed to create status update:', error);
      toast.error('Failed to create status update');
    } finally {
      setIsSubmitting(false);
    }
  }

  const progress = metrics
    ? Math.round((metrics.items.completed / Math.max(metrics.items.total, 1)) * 100)
    : 0;

  // Transform commits to timeline items
  const timelineItems: TimelineItem[] = useMemo(() => {
    return commits.map((commit) => ({
      id: commit.sha,
      title: commit.message,
      description: commit.repository,
      date: new Date(commit.date),
      user: {
        name: commit.author.name,
        avatar: commit.author.avatarUrl,
        initials: commit.author.name.slice(0, 2).toUpperCase(),
      },
      icon: <GitCommit className="h-4 w-4" weight="bold" />,
      type: 'default' as const,
      metadata: {
        sha: commit.shortSha,
      },
    }));
  }, [commits]);

  // Define columns for project items DataGrid
  const itemsColumns: DataGridColumn<ProjectItem>[] = useMemo(() => [
    {
      id: 'milestone',
      header: 'Milestone',
      accessorKey: 'milestone',
    },
    {
      id: 'type',
      header: 'Type',
      accessorKey: 'type',
      width: 100,
      cell: ({ value }) => {
        const type = value as keyof typeof ITEM_TYPE_CONFIG;
        const config = ITEM_TYPE_CONFIG[type];
        const Icon = config.icon;
        return (
          <div className="flex items-center gap-1.5">
            <Icon className={`h-4 w-4 ${config.color}`} weight="fill" />
            <span className="text-sm">{config.label}</span>
          </div>
        );
      },
    },
    {
      id: 'title',
      header: 'Title',
      accessorKey: 'title',
      width: 280,
      sortable: true,
      cell: ({ value }) => (
        <span className="font-medium truncate block max-w-[260px]" title={value}>
          {value}
        </span>
      ),
    },
    {
      id: 'assignees',
      header: 'Assignees',
      accessorKey: 'assignees',
      width: 120,
      cell: ({ value }) => {
        const assignees = value as Assignee[];
        if (assignees.length === 0) {
          return <span className="text-muted-foreground text-sm">Unassigned</span>;
        }
        const displayNames = assignees.map(a => a.name || a.login);
        return (
          <div className="flex items-center gap-1 min-w-0">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm truncate" title={displayNames.join(', ')}>
              {assignees.length === 1 ? displayNames[0] : `${assignees.length} people`}
            </span>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 100,
      cell: ({ value }) => {
        const status = value as string;
        return <Badge variant={getItemStatusVariant(status)}>{status}</Badge>;
      },
    },
    {
      id: 'estimate',
      header: 'Estimate',
      accessorKey: 'estimate',
      width: 80,
      sortable: true,
      cell: ({ value }) => {
        return value ? <span className="text-sm">{value}</span> : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      id: 'startDate',
      header: 'Start',
      accessorKey: 'startDate',
      width: 100,
      sortable: true,
      cell: ({ value }) => {
        return value ? <span className="text-sm">{new Date(value).toLocaleDateString()}</span> : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      id: 'targetDate',
      header: 'Target',
      accessorKey: 'targetDate',
      width: 100,
      sortable: true,
      cell: ({ value }) => {
        return value ? <span className="text-sm">{new Date(value).toLocaleDateString()}</span> : <span className="text-muted-foreground">-</span>;
      },
    },
    {
      id: 'percentComplete',
      header: '% Complete',
      accessorKey: 'percentComplete',
      width: 130,
      sortable: true,
      cell: ({ value }) => {
        const percent = value as number;
        return (
          <div className="flex items-center gap-2">
            <Progress value={percent} className="h-2 w-16" />
            <span className="text-sm text-muted-foreground">{percent}%</span>
          </div>
        );
      },
    },
    {
      id: 'actualEndDate',
      header: 'Actual End',
      accessorKey: 'actualEndDate',
      width: 100,
      sortable: true,
      cell: ({ value }) => {
        return value ? <span className="text-sm">{new Date(value).toLocaleDateString()}</span> : <span className="text-muted-foreground">-</span>;
      },
    },
  ], []);

  // Group config for DataGrid grouping
  const groupConfig = useMemo(() => [
    { field: 'milestone', label: 'Milestone' },
    { field: 'type', label: 'Type' },
    { field: 'status', label: 'Status' },
  ], []);

  // Define columns for risks DataGrid
  const risksColumns: DataGridColumn<Risk>[] = useMemo(() => [
    {
      id: 'title',
      header: 'Title',
      accessorKey: 'title',
      width: 200,
      sortable: true,
      cell: ({ value }) => (
        <span className="font-medium">{value}</span>
      ),
    },
    {
      id: 'severity',
      header: 'Severity',
      accessorKey: 'severity',
      width: 100,
      cell: ({ value }) => {
        const severity = value as Risk['severity'];
        const colors = {
          critical: 'bg-red-500',
          high: 'bg-orange-500',
          medium: 'bg-yellow-500',
          low: 'bg-blue-500',
        };
        return (
          <Badge className={colors[severity]}>
            {severity.charAt(0).toUpperCase() + severity.slice(1)}
          </Badge>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      width: 100,
      cell: ({ value }) => {
        const status = value as Risk['status'];
        const variants: Record<Risk['status'], 'default' | 'secondary' | 'outline'> = {
          open: 'default',
          mitigated: 'secondary',
          closed: 'outline',
        };
        return (
          <Badge variant={variants[status]}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </Badge>
        );
      },
    },
    {
      id: 'owner',
      header: 'Owner',
      accessorKey: 'owner',
      width: 120,
      cell: ({ value }) => {
        const owner = value as string | undefined;
        return owner ? (
          <div className="flex items-center gap-1">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">{owner}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">Unassigned</span>
        );
      },
    },
    {
      id: 'created_at',
      header: 'Created',
      accessorKey: 'created_at',
      width: 100,
      sortable: true,
      cell: ({ value }) => {
        const date = value as string;
        return <span className="text-sm">{new Date(date).toLocaleDateString()}</span>;
      },
    },
  ], []);

  async function handleCreateRisk() {
    if (!currentInstallation || !projectNumber || !newRiskTitle.trim()) return;

    setIsCreatingRisk(true);
    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/projects/${projectNumber}/project-risks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newRiskTitle.trim(),
            description: newRiskDescription.trim() || null,
            severity: newRiskSeverity,
            owner: newRiskOwner.trim() || null,
          }),
        }
      );

      if (response.ok) {
        const created = await response.json();
        setRisks((prev) => [...prev, created]);
        setRiskDialogOpen(false);
        setNewRiskTitle('');
        setNewRiskDescription('');
        setNewRiskSeverity('medium');
        setNewRiskOwner('');
        toast.success('Risk created');
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to create risk');
      }
    } catch (error) {
      console.error('Failed to create risk:', error);
      toast.error('Failed to create risk');
    } finally {
      setIsCreatingRisk(false);
    }
  }

  // Reordered: Project #, Owner, Progress, Status, GitHub
  const highlights = project ? [
    { label: 'Project', value: `#${project.number}` },
    { label: 'Owner', value: project.owner },
    { label: 'Progress', value: metrics ? `${progress}%` : 'N/A' },
    { label: 'Status', value: metrics ? getHealthBadge(metrics.health) : 'N/A' },
    {
      label: 'GitHub',
      value: project.url ? (
        <a
          href={project.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline flex items-center gap-1"
        >
          View <ArrowSquareOut className="h-3 w-3" />
        </a>
      ) : 'N/A'
    },
  ] : [];

  const tabs = metrics ? [
    {
      value: 'items',
      label: 'Items',
      content: itemsLoading ? (
        <div className="text-center py-8 text-muted-foreground">Loading items...</div>
      ) : projectItems.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No items in this project</div>
      ) : (
        <DataGrid
          columns={itemsColumns}
          data={projectItems}
          enableSorting
          enableGrouping
          groupBy="milestone"
          groupConfig={groupConfig}
          enableColumnChooser
          enableColumnResizing
          enableExport
          exportFilename={`project-${project?.number}-items`}
          getRowId={(row) => row.id}
        />
      ),
    },
    {
      value: 'risks',
      label: 'Risks',
      content: (
        <div className="space-y-4">
          {/* Summary cards - 4 columns */}
          <div className="grid grid-cols-4 gap-4">
            <div className="p-4 border rounded-lg">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Critical</div>
              <div className={`text-2xl font-bold mt-1 ${metrics.risks.critical > 0 ? 'text-red-600' : ''}`}>
                {metrics.risks.critical}
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">High</div>
              <div className={`text-2xl font-bold mt-1 ${metrics.risks.high > 0 ? 'text-orange-600' : ''}`}>
                {metrics.risks.high}
              </div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Medium</div>
              <div className="text-2xl font-bold mt-1">{metrics.risks.medium}</div>
            </div>
            <div className="p-4 border rounded-lg">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Low</div>
              <div className="text-2xl font-bold mt-1">{metrics.risks.low}</div>
            </div>
          </div>

          {/* Risks DataGrid */}
          <DataGrid
            columns={risksColumns}
            data={risks}
            enableSorting
            getRowId={(row) => String(row.id)}
            toolbarActions={
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8"
                onClick={() => setRiskDialogOpen(true)}
              >
                <Plus className="h-4 w-4" weight="bold" />
              </Button>
            }
          />
        </div>
      ),
    },
    {
      value: 'timeline',
      label: 'Timeline',
      content: (
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 border rounded-lg">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">On Track</div>
            <div className="text-2xl font-bold mt-1 text-green-600">{metrics.timeline.onTrack}</div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Behind</div>
            <div className={`text-2xl font-bold mt-1 ${metrics.timeline.behind > 0 ? 'text-red-600' : ''}`}>
              {metrics.timeline.behind}
            </div>
          </div>
          <div className="p-4 border rounded-lg">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ahead</div>
            <div className="text-2xl font-bold mt-1 text-blue-600">{metrics.timeline.ahead}</div>
          </div>
        </div>
      ),
    },
  ] : [];

  return (
    <>
      <AppShell.Header>
        <div className="flex items-center gap-3 w-full">
          <Link to="/app/projects">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full bg-background shadow-[0_0_20px] shadow-border/70"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold truncate">
              {isLoading ? 'Loading...' : project?.title || 'Project Not Found'}
            </h1>
            {project?.description && (
              <p className="text-sm text-muted-foreground truncate">
                {project.description}
              </p>
            )}
          </div>
          {project && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="shrink-0">
                  <Plus className="h-4 w-4 mr-2" />
                  Status Update
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Status Update</DialogTitle>
                  <DialogDescription>
                    Post a new status update for this project.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select
                      value={newStatus}
                      onValueChange={(value) => setNewStatus(value as typeof newStatus)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select status">
                          <span className="flex items-center gap-2">
                            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_CONFIG[newStatus].color}`} />
                            {STATUS_CONFIG[newStatus].label}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_CONFIG) as Array<keyof typeof STATUS_CONFIG>).map((key) => (
                          <SelectItem key={key} value={key} className="py-2">
                            <div className="flex items-start gap-2">
                              <span className={`h-2.5 w-2.5 rounded-full mt-1 shrink-0 ${STATUS_CONFIG[key].color}`} />
                              <div className="text-left">
                                <div className="font-medium">{STATUS_CONFIG[key].label}</div>
                                <div className="text-xs text-muted-foreground">{STATUS_CONFIG[key].description}</div>
                              </div>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <MarkdownEditor
                    value={newBody}
                    onChange={setNewBody}
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDialogOpen(false)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateStatusUpdate}
                    disabled={isSubmitting || !newBody.trim()}
                  >
                    {isSubmitting ? 'Creating...' : 'Create Update'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </AppShell.Header>

      <AppShell.Body className="relative">
        <PageLoadingCover loading={isLoading} pageName="Project" />
        {!project && !isLoading ? (
          <div className="p-6 text-center">
            <Warning className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">Project Not Found</h3>
            <p className="text-muted-foreground mb-4">
              This project may not be tracked or doesn't exist.
            </p>
            <Link to="/app/projects">
              <Button>Back to Projects</Button>
            </Link>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {/* Highlights Bar */}
            <RecordDetailHighlights items={highlights} />

            {/* Two Column Layout with Resizable Splitter */}
            <div className="flex-1 overflow-hidden">
              <ResizablePanelGroup direction="horizontal" className="h-full">
                {/* Left Column - Tabbed Container */}
                <ResizablePanel defaultSize={72} minSize={40}>
                  <div className="h-full overflow-auto px-6 pt-6">
                    {tabs.length > 0 && (
                      <TabbedContainer tabs={tabs} defaultValue="items" />
                    )}
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* Right Column - Vertical Stack */}
                <ResizablePanel defaultSize={28} minSize={20} maxSize={40}>
                  <div className="h-full overflow-auto px-6 pt-6 flex flex-col gap-4">
                    {/* Latest Status Update */}
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <ChatText className="h-4 w-4" />
                          Latest Status Update
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        {statusUpdate ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              {getStatusBadge(statusUpdate.status)}
                              <span className="text-xs text-muted-foreground">
                                {new Date(statusUpdate.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <div
                              className="text-sm prose-content"
                              dangerouslySetInnerHTML={{ __html: statusUpdate.bodyHTML || statusUpdate.body }}
                            />
                            {statusUpdate.creator && (
                              <div className="text-xs text-muted-foreground">
                                by @{statusUpdate.creator.login}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground py-4 text-center">
                            No status updates yet
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Commits Since Last Update */}
                    {timelineItems.length > 0 && (
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <GitCommit className="h-4 w-4" />
                            Commits Since Last Update
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ActivityTimeline
                            items={timelineItems}
                            relativeTime
                          />
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
          </div>
        )}
      </AppShell.Body>

      {/* New Risk Dialog */}
      <Dialog open={riskDialogOpen} onOpenChange={setRiskDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Risk</DialogTitle>
            <DialogDescription>
              Add a new risk to track for this project.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="risk-title">Title</Label>
              <Input
                id="risk-title"
                value={newRiskTitle}
                onChange={(e) => setNewRiskTitle(e.target.value)}
                placeholder="Risk title..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-description">Description</Label>
              <Textarea
                id="risk-description"
                value={newRiskDescription}
                onChange={(e) => setNewRiskDescription(e.target.value)}
                placeholder="Describe the risk..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-severity">Severity</Label>
              <Select
                value={newRiskSeverity}
                onValueChange={(value) => setNewRiskSeverity(value as Risk['severity'])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="critical">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      Critical
                    </span>
                  </SelectItem>
                  <SelectItem value="high">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-orange-500" />
                      High
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-yellow-500" />
                      Medium
                    </span>
                  </SelectItem>
                  <SelectItem value="low">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      Low
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="risk-owner">Owner (optional)</Label>
              <Input
                id="risk-owner"
                value={newRiskOwner}
                onChange={(e) => setNewRiskOwner(e.target.value)}
                placeholder="Who owns this risk?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRiskDialogOpen(false)}
              disabled={isCreatingRisk}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateRisk}
              disabled={isCreatingRisk || !newRiskTitle.trim()}
            >
              {isCreatingRisk ? 'Creating...' : 'Create Risk'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
