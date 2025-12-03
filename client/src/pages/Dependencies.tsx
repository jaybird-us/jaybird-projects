import { useEffect, useState } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@jybrd/design-system/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import {
  GitBranch,
  Path,
  Check,
  Circle,
  CaretRight,
  Lightning,
  Clock,
  Warning
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';

interface TrackedProject {
  id: string;
  number: number;
  title: string;
  owner: string;
}

interface GraphNode {
  id: string;
  issueNumber: number;
  title: string;
  state: string;
  status: string;
  startDate: string | null;
  targetDate: string | null;
  estimate: string | null;
  isCompleted: boolean;
  isSummary: boolean;
  hasChildren: boolean;
  parentNumber: number | null;
  duration: number;
  buffer: number;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'dependency' | 'parent-child';
}

interface CriticalPathNode {
  id: string;
  issueNumber: number;
  title: string;
  duration: number;
  earlyStart: number;
  earlyFinish: number;
}

interface SlackNode {
  id: string;
  issueNumber: number;
  title: string;
  slack: number;
}

interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  criticalPath: {
    nodes: CriticalPathNode[];
    totalDuration: number;
    nodesWithSlack: SlackNode[];
  };
  stats: {
    totalNodes: number;
    totalEdges: number;
    dependencyEdges: number;
    parentChildEdges: number;
  };
}

export function Dependencies() {
  const { currentInstallation } = useAuth();
  const [trackedProjects, setTrackedProjects] = useState<TrackedProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [graphData, setGraphData] = useState<DependencyGraph | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    if (currentInstallation) {
      fetchTrackedProjects();
    }
  }, [currentInstallation]);

  useEffect(() => {
    if (selectedProject) {
      fetchDependencyGraph(selectedProject);
    } else {
      setGraphData(null);
    }
  }, [selectedProject]);

  async function fetchTrackedProjects() {
    if (!currentInstallation) return;

    try {
      const response = await fetch(`/api/installations/${currentInstallation.id}/projects`);
      if (response.ok) {
        const data = await response.json();
        const tracked = data.filter((p: { tracked: boolean }) => p.tracked);
        setTrackedProjects(tracked);
        if (tracked.length === 1) {
          setSelectedProject(tracked[0].number.toString());
        }
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    }
  }

  async function fetchDependencyGraph(projectNumber: string) {
    if (!currentInstallation) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/projects/${projectNumber}/dependencies`
      );
      if (response.ok) {
        const data = await response.json();
        setGraphData(data);
      } else {
        toast.error('Failed to load dependency graph');
      }
    } catch (error) {
      console.error('Failed to fetch dependency graph:', error);
      toast.error('Failed to load dependency graph');
    } finally {
      setIsLoading(false);
    }
  }

  // Helper to get blockers for a node
  function getBlockers(nodeId: string): GraphNode[] {
    if (!graphData) return [];
    const blockerEdges = graphData.edges.filter(
      e => e.target === nodeId && e.type === 'dependency'
    );
    return blockerEdges.map(e =>
      graphData.nodes.find(n => n.id === e.source)
    ).filter(Boolean) as GraphNode[];
  }

  // Helper to get blocked by this node
  function getBlocked(nodeId: string): GraphNode[] {
    if (!graphData) return [];
    const blockedEdges = graphData.edges.filter(
      e => e.source === nodeId && e.type === 'dependency'
    );
    return blockedEdges.map(e =>
      graphData.nodes.find(n => n.id === e.target)
    ).filter(Boolean) as GraphNode[];
  }

  // Check if node is on critical path
  function isOnCriticalPath(nodeId: string): boolean {
    if (!graphData) return false;
    return graphData.criticalPath.nodes.some(n => n.id === nodeId);
  }

  return (
    <>
      <AppShell.Header
        title="Dependencies"
        description="Visualize project dependencies and critical path"
      />

      <AppShell.Body className="p-6 relative">
        <PageLoadingCover loading={isLoading} pageName="Dependencies" />
        {/* Project Selector */}
        <div className="mb-6 flex items-center gap-4">
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Select a project..." />
            </SelectTrigger>
            <SelectContent>
              {trackedProjects.map((project) => (
                <SelectItem key={project.number} value={project.number.toString()}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {graphData && (
            <div className="text-sm text-muted-foreground">
              {graphData.stats.totalNodes} items, {graphData.stats.dependencyEdges} dependencies
            </div>
          )}
        </div>

        {!selectedProject && !isLoading ? (
          <Card>
            <CardContent className="p-8 text-center">
              <GitBranch className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                Select a project to view its dependency graph and critical path
              </p>
            </CardContent>
          </Card>
        ) : graphData ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Critical Path Card */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Path className="h-5 w-5" />
                  Critical Path
                </CardTitle>
                <CardDescription>
                  The longest chain of dependent items determining project duration.
                  Total: {graphData.criticalPath.totalDuration} working days
                </CardDescription>
              </CardHeader>
              <CardContent>
                {graphData.criticalPath.nodes.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No critical path found. Items may not have dependencies defined.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {graphData.criticalPath.nodes.map((node, index) => (
                      <div
                        key={node.id}
                        className="flex items-center gap-2 p-3 border rounded-lg bg-destructive/5 border-destructive/20"
                      >
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-destructive/10 flex items-center justify-center">
                          <span className="text-sm font-medium text-destructive">
                            {index + 1}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">#{node.issueNumber} {node.title}</div>
                          <div className="text-sm text-muted-foreground">
                            Days {node.earlyStart} - {node.earlyFinish} ({node.duration} days duration)
                          </div>
                        </div>
                        {index < graphData.criticalPath.nodes.length - 1 && (
                          <CaretRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stats Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Lightning className="h-5 w-5" />
                  Graph Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Items</span>
                  <span className="font-medium">{graphData.stats.totalNodes}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Dependencies</span>
                  <span className="font-medium">{graphData.stats.dependencyEdges}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Parent-Child</span>
                  <span className="font-medium">{graphData.stats.parentChildEdges}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Critical Items</span>
                  <span className="font-medium text-destructive">
                    {graphData.criticalPath.nodes.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Project Duration</span>
                  <span className="font-medium">{graphData.criticalPath.totalDuration} days</span>
                </div>
              </CardContent>
            </Card>

            {/* Items with Slack */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Items with Slack Time
                </CardTitle>
                <CardDescription>
                  Items that have flexibility in their schedule without affecting the project end date
                </CardDescription>
              </CardHeader>
              <CardContent>
                {graphData.criticalPath.nodesWithSlack.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No items with slack time found.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {graphData.criticalPath.nodesWithSlack.slice(0, 10).map((node) => (
                      <div
                        key={node.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">#{node.issueNumber}</span>
                          <span className="ml-2 text-muted-foreground truncate">
                            {node.title}
                          </span>
                        </div>
                        <Badge variant="secondary" className="ml-4">
                          {node.slack} days slack
                        </Badge>
                      </div>
                    ))}
                    {graphData.criticalPath.nodesWithSlack.length > 10 && (
                      <p className="text-sm text-muted-foreground text-center pt-2">
                        ...and {graphData.criticalPath.nodesWithSlack.length - 10} more items
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Selected Node Details or Legend */}
            <Card>
              <CardHeader>
                <CardTitle>Legend</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-destructive/20 border border-destructive/40" />
                  <span className="text-sm">Critical Path Item</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-primary/20 border border-primary/40" />
                  <span className="text-sm">Has Dependencies</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-muted border" />
                  <span className="text-sm">Independent Item</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-sm">Completed</span>
                </div>
              </CardContent>
            </Card>

            {/* Dependency List */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <GitBranch className="h-5 w-5" />
                  All Dependencies
                </CardTitle>
                <CardDescription>
                  Click on an item to see its dependency details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {graphData.nodes
                    .sort((a, b) => {
                      // Critical path first, then by dependencies
                      const aOnCritical = isOnCriticalPath(a.id) ? 0 : 1;
                      const bOnCritical = isOnCriticalPath(b.id) ? 0 : 1;
                      if (aOnCritical !== bOnCritical) return aOnCritical - bOnCritical;
                      return getBlockers(b.id).length - getBlockers(a.id).length;
                    })
                    .map((node) => {
                      const blockers = getBlockers(node.id);
                      const blocked = getBlocked(node.id);
                      const onCriticalPath = isOnCriticalPath(node.id);
                      const isSelected = selectedNode?.id === node.id;

                      return (
                        <div
                          key={node.id}
                          className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                            onCriticalPath
                              ? 'bg-destructive/5 border-destructive/30 hover:bg-destructive/10'
                              : blockers.length > 0 || blocked.length > 0
                                ? 'bg-primary/5 border-primary/20 hover:bg-primary/10'
                                : 'hover:bg-accent'
                          } ${isSelected ? 'ring-2 ring-primary' : ''}`}
                          onClick={() => setSelectedNode(isSelected ? null : node)}
                        >
                          <div className="flex items-center gap-3">
                            {/* Status indicator */}
                            <div className="flex-shrink-0">
                              {node.isCompleted ? (
                                <div className="h-6 w-6 rounded-full bg-green-100 flex items-center justify-center">
                                  <Check className="h-4 w-4 text-green-600" weight="bold" />
                                </div>
                              ) : onCriticalPath ? (
                                <div className="h-6 w-6 rounded-full bg-destructive/20 flex items-center justify-center">
                                  <Warning className="h-4 w-4 text-destructive" />
                                </div>
                              ) : (
                                <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center">
                                  <Circle className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>

                            {/* Node info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">#{node.issueNumber}</span>
                                <span className="truncate">{node.title}</span>
                                {onCriticalPath && (
                                  <Badge variant="destructive" className="flex-shrink-0">
                                    Critical
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                                {node.estimate && <span>{node.estimate}</span>}
                                <span>{node.duration} days</span>
                                {node.targetDate && <span>Target: {node.targetDate}</span>}
                              </div>
                            </div>

                            {/* Dependency indicators */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {blockers.length > 0 && (
                                <Badge variant="outline">
                                  {blockers.length} blocker{blockers.length !== 1 ? 's' : ''}
                                </Badge>
                              )}
                              {blocked.length > 0 && (
                                <Badge variant="secondary">
                                  blocks {blocked.length}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Expanded details */}
                          {isSelected && (blockers.length > 0 || blocked.length > 0) && (
                            <div className="mt-4 pt-4 border-t space-y-3">
                              {blockers.length > 0 && (
                                <div>
                                  <div className="text-sm font-medium mb-2">Blocked by:</div>
                                  <div className="flex flex-wrap gap-2">
                                    {blockers.map((b) => (
                                      <Badge
                                        key={b.id}
                                        variant={b.isCompleted ? 'secondary' : 'destructive'}
                                        className="cursor-pointer"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedNode(b);
                                        }}
                                      >
                                        #{b.issueNumber} {b.title.slice(0, 30)}
                                        {b.title.length > 30 ? '...' : ''}
                                        {b.isCompleted && ' (Done)'}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {blocked.length > 0 && (
                                <div>
                                  <div className="text-sm font-medium mb-2">Blocks:</div>
                                  <div className="flex flex-wrap gap-2">
                                    {blocked.map((b) => (
                                      <Badge
                                        key={b.id}
                                        variant="outline"
                                        className="cursor-pointer"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedNode(b);
                                        }}
                                      >
                                        #{b.issueNumber} {b.title.slice(0, 30)}
                                        {b.title.length > 30 ? '...' : ''}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </AppShell.Body>
    </>
  );
}
