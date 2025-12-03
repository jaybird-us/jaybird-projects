import { useEffect, useState, useMemo, useCallback } from 'react';
import { AppShell } from '@jybrd/design-system/compounds/app-shell';
import { FileBrowser, type SidebarSection } from '@jybrd/design-system/compounds/file-browser';
import type { FileItem } from '@jybrd/design-system/compounds/file-list';
import { Button } from '@jybrd/design-system/components/ui/button';
import { Badge } from '@jybrd/design-system/components/ui/badge';
import { Input } from '@jybrd/design-system/components/ui/input';
import { Textarea } from '@jybrd/design-system/components/ui/textarea';
import { Label } from '@jybrd/design-system/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@jybrd/design-system/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@jybrd/design-system/components/ui/select';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@jybrd/design-system/components/ui/context-menu';
import { useAuth } from '@/contexts/AuthContext';
import {
  Clock,
  PushPin,
  Folder,
  Scroll,
  ListChecks,
  ChartLine,
  Scales,
  Warning,
  Notebook,
  Tag,
  ArrowsClockwise,
  FileText,
  Plus,
  Trash,
  PencilSimple,
  ClockCounterClockwise,
  DownloadSimple,
  FolderOpen,
  UploadSimple,
  File,
  X,
  FilePdf,
  FileDoc,
  FileXls,
  FilePpt,
  FileImage,
  FileZip,
  FileCode,
  FileCsv,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { PageLoadingCover } from '@/components/ui/page-loading-cover';

interface Document {
  id: number;
  title: string;
  type: string;
  content: string;
  status: string;
  version: number;
  project_number: number | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  linkedIssues: string[];
  linkedMilestones: string[];
  pinned: boolean;
  hasFile: boolean;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
}

interface DocumentVersion {
  id: number;
  document_id: number;
  version: number;
  title: string;
  content: string;
  changed_by: string;
  changed_at: string;
  change_summary: string;
}

interface TrackedProject {
  id: string;
  number: number;
  title: string;
  owner: string;
  tracked: boolean;
}

interface DocumentCounts {
  pinned: number;
  recent: number;
  byProject: Record<number, number>;
}

const DOCUMENT_TYPES = [
  { value: 'charter', label: 'Project Charter' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'status_report', label: 'Status Report' },
  { value: 'decision_log', label: 'Decision Log' },
  { value: 'risk_register', label: 'Risk Register' },
  { value: 'meeting_notes', label: 'Meeting Notes' },
  { value: 'release_notes', label: 'Release Notes' },
  { value: 'retrospective', label: 'Retrospective' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'review', label: 'In Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'archived', label: 'Archived' },
];

// Map document types to Phosphor icons
function getDocumentIcon(type: string) {
  switch (type) {
    case 'charter':
      return Scroll;
    case 'requirements':
      return ListChecks;
    case 'status_report':
      return ChartLine;
    case 'decision_log':
      return Scales;
    case 'risk_register':
      return Warning;
    case 'meeting_notes':
      return Notebook;
    case 'release_notes':
      return Tag;
    case 'retrospective':
      return ArrowsClockwise;
    default:
      return FileText;
  }
}

// Get file icon based on mime type
function getFileTypeIcon(mimeType: string | null) {
  if (!mimeType) return File;

  if (mimeType.includes('pdf')) return FilePdf;
  if (mimeType.includes('word') || mimeType.includes('document')) return FileDoc;
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return FileXls;
  if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return FilePpt;
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return FileZip;
  if (mimeType.includes('csv')) return FileCsv;
  if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('html')) return FileCode;

  return File;
}

// Check if file type supports preview
function canPreviewFile(mimeType: string | null): boolean {
  if (!mimeType) return false;
  return (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('image/')
  );
}

export function Documents() {
  const { currentInstallation } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [allProjects, setAllProjects] = useState<TrackedProject[]>([]);
  const [documentCounts, setDocumentCounts] = useState<DocumentCounts>({ pinned: 0, recent: 0, byProject: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [editingDocument, setEditingDocument] = useState<Document | null>(null);
  const [viewingDocument, setViewingDocument] = useState<Document | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [activeFilter, setActiveFilter] = useState<string>('recent');
  const [selectedItems, setSelectedItems] = useState<FileItem[]>([]);
  const [contextMenuItem, setContextMenuItem] = useState<FileItem | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formData, setFormData] = useState({
    title: '',
    type: 'other',
    content: '',
    status: 'draft',
    projectNumber: '' as string | number,
  });

  // Fetch all data on mount
  useEffect(() => {
    if (currentInstallation) {
      fetchAllData();
    }
  }, [currentInstallation]);

  async function fetchAllData() {
    if (!currentInstallation) return;

    setIsLoading(true);
    try {
      const [projectsRes, countsRes] = await Promise.all([
        fetch(`/api/installations/${currentInstallation.id}/projects`),
        fetch(`/api/installations/${currentInstallation.id}/documents/counts`),
      ]);

      if (projectsRes.ok) {
        const projects = await projectsRes.json();
        setAllProjects(projects);
      }

      if (countsRes.ok) {
        const counts = await countsRes.json();
        setDocumentCounts(counts);
      }

      // Fetch documents based on default filter
      await fetchDocuments('recent');
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error('Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchDocuments(filter: string) {
    if (!currentInstallation) return;

    try {
      let url = `/api/installations/${currentInstallation.id}/documents`;

      if (filter === 'recent') {
        url += '?filter=recent';
      } else if (filter === 'pinned') {
        url += '?filter=pinned';
      } else if (filter.startsWith('project-')) {
        const projectNumber = filter.replace('project-', '');
        url += `?projectNumber=${projectNumber}`;
      }

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      } else {
        toast.error('Failed to load documents');
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
      toast.error('Failed to load documents');
    }
  }

  async function fetchVersions(documentId: number) {
    if (!currentInstallation) return;

    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/documents/${documentId}/versions`
      );
      if (response.ok) {
        const data = await response.json();
        setVersions(data);
      }
    } catch (error) {
      console.error('Failed to fetch versions:', error);
    }
  }

  async function refreshCounts() {
    if (!currentInstallation) return;
    try {
      const response = await fetch(`/api/installations/${currentInstallation.id}/documents/counts`);
      if (response.ok) {
        const counts = await response.json();
        setDocumentCounts(counts);
      }
    } catch (error) {
      console.error('Failed to refresh counts:', error);
    }
  }

  async function handleSubmit() {
    if (!currentInstallation) return;

    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }

    if (!formData.projectNumber) {
      toast.error('Please select a project');
      return;
    }

    // Require file for new documents
    if (!editingDocument && !selectedFile) {
      toast.error('Please select a file to upload');
      return;
    }

    try {
      const isEditing = !!editingDocument;
      const url = isEditing
        ? `/api/installations/${currentInstallation.id}/documents/${editingDocument.id}`
        : `/api/installations/${currentInstallation.id}/documents`;

      // Use FormData for file upload
      const formDataToSend = new FormData();
      formDataToSend.append('title', formData.title);
      formDataToSend.append('type', formData.type);
      formDataToSend.append('content', formData.content);
      formDataToSend.append('status', formData.status);
      formDataToSend.append('projectNumber', String(formData.projectNumber));
      formDataToSend.append('linkedIssues', JSON.stringify([]));
      formDataToSend.append('linkedMilestones', JSON.stringify([]));

      if (selectedFile) {
        formDataToSend.append('file', selectedFile);
      }

      const response = await fetch(url, {
        method: isEditing ? 'PUT' : 'POST',
        body: formDataToSend,
      });

      if (response.ok) {
        toast.success(isEditing ? 'Document updated' : 'Document created');
        setIsDialogOpen(false);
        resetForm();
        await fetchDocuments(activeFilter);
        await refreshCounts();
      } else {
        const error = await response.json();
        toast.error(error.error || 'Failed to save document');
      }
    } catch (error) {
      console.error('Failed to save document:', error);
      toast.error('Failed to save document');
    }
  }

  async function handleDelete(items: FileItem[]) {
    if (!currentInstallation) return;

    const itemCount = items.length;
    const confirmMessage = itemCount === 1
      ? `Are you sure you want to delete "${items[0].name}"?`
      : `Are you sure you want to delete ${itemCount} documents?`;

    if (!confirm(confirmMessage)) return;

    try {
      const deletePromises = items.map((item) =>
        fetch(`/api/installations/${currentInstallation.id}/documents/${item.metadata?.documentId}`, {
          method: 'DELETE',
        })
      );

      await Promise.all(deletePromises);
      toast.success(itemCount === 1 ? 'Document deleted' : `${itemCount} documents deleted`);
      setSelectedItems([]);
      await fetchDocuments(activeFilter);
      await refreshCounts();
    } catch (error) {
      console.error('Failed to delete document(s):', error);
      toast.error('Failed to delete document(s)');
    }
  }

  async function handleTogglePin(item: FileItem) {
    if (!currentInstallation) return;

    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/documents/${item.metadata?.documentId}/pin`,
        { method: 'PATCH' }
      );

      if (response.ok) {
        const { pinned } = await response.json();
        toast.success(pinned ? 'Document pinned' : 'Document unpinned');
        await fetchDocuments(activeFilter);
        await refreshCounts();
      } else {
        toast.error('Failed to update pin status');
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      toast.error('Failed to update pin status');
    }
  }

  function resetForm() {
    setFormData({ title: '', type: 'other', content: '', status: 'draft', projectNumber: '' });
    setEditingDocument(null);
    setSelectedFile(null);
  }

  function openEditDialog(doc: Document) {
    setEditingDocument(doc);
    setFormData({
      title: doc.title,
      type: doc.type,
      content: doc.content,
      status: doc.status,
      projectNumber: doc.project_number || '',
    });
    setIsDialogOpen(true);
  }

  function openVersionsDialog(doc: Document) {
    fetchVersions(doc.id);
    setEditingDocument(doc);
    setIsVersionDialogOpen(true);
  }

  function getProjectName(projectNumber: number | null) {
    if (!projectNumber) return null;
    const project = trackedProjects.find((p) => p.number === projectNumber);
    return project?.title || `Project #${projectNumber}`;
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      // Auto-fill title from filename if empty
      if (!formData.title) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        setFormData({ ...formData, title: nameWithoutExt });
      }
    }
  }

  // Transform documents to FileItem format
  const fileItems: FileItem[] = useMemo(() => {
    return documents.map((doc) => ({
      id: String(doc.id),
      name: doc.title,
      type: 'file' as const,
      size: doc.file_size || 0,
      modified: new Date(doc.updated_at),
      icon: getFileTypeIcon(doc.file_type),
      metadata: {
        documentId: doc.id,
        documentType: doc.type,
        status: doc.status,
        projectNumber: doc.project_number,
        version: doc.version,
        pinned: doc.pinned,
        content: doc.content,
        createdBy: doc.created_by,
        updatedBy: doc.updated_by,
        hasFile: doc.hasFile,
        fileName: doc.file_name,
        fileType: doc.file_type,
        fileSize: doc.file_size,
      },
    }));
  }, [documents]);

  // Helper to get tracked projects for forms
  const trackedProjects = useMemo(() => allProjects.filter(p => p.tracked), [allProjects]);

  // Build sidebar sections
  const sidebarSections: SidebarSection[] = useMemo(() => {
    const sections: SidebarSection[] = [
      {
        id: 'quick-access',
        label: 'Quick Access',
        icon: Clock,
        collapsible: false,
        items: [
          {
            id: 'recent',
            label: 'Recent',
            icon: Clock,
            badge: documentCounts.recent > 0 ? documentCounts.recent : undefined,
          },
          {
            id: 'pinned',
            label: 'Pinned',
            icon: PushPin,
            badge: documentCounts.pinned > 0 ? documentCounts.pinned : undefined,
          },
        ],
      },
    ];

    if (allProjects.length > 0) {
      sections.push({
        id: 'projects',
        label: 'Projects',
        icon: Folder,
        collapsible: false,
        items: allProjects.map((p) => ({
          id: `project-${p.number}`,
          label: p.title,
          icon: Folder,
          badge: p.tracked ? (documentCounts.byProject[p.number] || undefined) : undefined,
          disabled: !p.tracked,
        })),
      });
    }

    return sections;
  }, [allProjects, documentCounts]);

  const handleSectionChange = useCallback(
    (sectionId: string, itemId?: string) => {
      const newFilter = itemId || sectionId;

      // Check if clicking a non-tracked project
      if (newFilter.startsWith('project-')) {
        const projectNumber = parseInt(newFilter.replace('project-', ''));
        const project = allProjects.find(p => p.number === projectNumber);
        if (project && !project.tracked) {
          toast.info('Start tracking this project to view its documents');
          return;
        }
      }

      setActiveFilter(newFilter);
      fetchDocuments(newFilter);
    },
    [currentInstallation, allProjects]
  );

  const handleItemClick = useCallback((item: FileItem) => {
    // Open file detail modal
    const doc = documents.find((d) => d.id === item.metadata?.documentId);
    if (doc) {
      setViewingDocument(doc);
      setIsDetailDialogOpen(true);
    }
  }, [documents]);

  const handleItemDoubleClick = useCallback((item: FileItem) => {
    // Double-click also opens detail modal (consistent behavior)
    const doc = documents.find((d) => d.id === item.metadata?.documentId);
    if (doc) {
      setViewingDocument(doc);
      setIsDetailDialogOpen(true);
    }
  }, [documents]);

  const handleEditFromDetail = useCallback(() => {
    if (viewingDocument) {
      setIsDetailDialogOpen(false);
      openEditDialog(viewingDocument);
    }
  }, [viewingDocument]);

  const handleDownloadFromDetail = useCallback(() => {
    if (!viewingDocument || !currentInstallation) return;

    const downloadUrl = `/api/installations/${currentInstallation.id}/documents/${viewingDocument.id}/download`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = viewingDocument.file_name || viewingDocument.title;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Document downloaded');
  }, [viewingDocument, currentInstallation]);

  const handleDeleteFromDetail = useCallback(async () => {
    if (!viewingDocument || !currentInstallation) return;

    if (!confirm(`Are you sure you want to delete "${viewingDocument.title}"?`)) return;

    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/documents/${viewingDocument.id}`,
        { method: 'DELETE' }
      );

      if (response.ok) {
        toast.success('Document deleted');
        setIsDetailDialogOpen(false);
        setViewingDocument(null);
        await fetchDocuments(activeFilter);
        await refreshCounts();
      } else {
        toast.error('Failed to delete document');
      }
    } catch (error) {
      console.error('Failed to delete document:', error);
      toast.error('Failed to delete document');
    }
  }, [viewingDocument, currentInstallation, activeFilter]);

  const handlePinFromDetail = useCallback(async () => {
    if (!viewingDocument || !currentInstallation) return;

    try {
      const response = await fetch(
        `/api/installations/${currentInstallation.id}/documents/${viewingDocument.id}/pin`,
        { method: 'PATCH' }
      );

      if (response.ok) {
        const { pinned } = await response.json();
        toast.success(pinned ? 'Document pinned' : 'Document unpinned');
        // Update the viewing document state
        setViewingDocument({ ...viewingDocument, pinned });
        await fetchDocuments(activeFilter);
        await refreshCounts();
      } else {
        toast.error('Failed to update pin status');
      }
    } catch (error) {
      console.error('Failed to toggle pin:', error);
      toast.error('Failed to update pin status');
    }
  }, [viewingDocument, currentInstallation, activeFilter]);

  const handleAdd = useCallback(() => {
    resetForm();
    setIsDialogOpen(true);
  }, []);

  const handleDownload = useCallback((items: FileItem[]) => {
    if (!currentInstallation) return;

    // Download each document file
    items.forEach((item) => {
      const doc = documents.find((d) => d.id === item.metadata?.documentId);
      if (doc && doc.hasFile) {
        // Use the download endpoint
        const downloadUrl = `/api/installations/${currentInstallation.id}/documents/${doc.id}/download`;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = doc.file_name || doc.title;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    });
    toast.success(items.length === 1 ? 'Document downloaded' : `${items.length} documents downloaded`);
  }, [documents, currentInstallation]);

  // Custom toolbar actions
  const toolbarActions = useMemo(() => (
    <div className="flex items-center gap-2">
      {selectedItems.length > 0 && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownload(selectedItems)}
          >
            <DownloadSimple className="h-4 w-4 mr-2" />
            Download
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDelete(selectedItems)}
          >
            <Trash className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </>
      )}
    </div>
  ), [selectedItems, handleDownload, handleDelete]);

  const handleContextMenu = useCallback((item: FileItem, event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenuItem(item);
  }, []);

  return (
    <>
      <AppShell.Header
        title="Documents"
        description="Project documentation and artifacts"
        actions={
          <Button onClick={handleAdd}>
            <Plus className="h-4 w-4 mr-2" />
            New Document
          </Button>
        }
      />

      <AppShell.Body className="relative">
        <PageLoadingCover loading={isLoading} pageName="Documents" />
        {allProjects.length === 0 && !isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No projects found</h3>
              <p className="text-muted-foreground mb-4">
                Create a project in GitHub to start managing documents.
              </p>
              <Button asChild variant="outline">
                <a href="/app">Go to Dashboard</a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="h-full">
            <FileBrowser
              data={fileItems}
              sections={sidebarSections}
              defaultSection="recent"
              sidebarWidth={260}
              showToolbar
              enableSearch
              enableSort
              enableSelection
              onSectionChange={handleSectionChange}
              onItemClick={handleItemClick}
              onItemDoubleClick={handleItemDoubleClick}
              onSelectionChange={setSelectedItems}
              onDelete={handleDelete}
              onDownload={handleDownload}
              onAdd={handleAdd}
              onItemContextMenu={handleContextMenu}
              toolbarActions={toolbarActions}
              className="h-full"
            />
          </div>
        )}

        {/* Create/Edit Dialog */}
        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingDocument ? 'Edit Document' : 'Create Document'}</DialogTitle>
              <DialogDescription>
                {editingDocument
                  ? 'Update the document details below.'
                  : 'Create a new project document to keep your team aligned.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {/* Project Selector */}
              <div className="grid gap-2">
                <Label htmlFor="project">Project *</Label>
                <Select
                  value={String(formData.projectNumber)}
                  onValueChange={(value) => setFormData({ ...formData, projectNumber: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {trackedProjects.map((project) => (
                      <SelectItem key={project.number} value={String(project.number)}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Document title"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => setFormData({ ...formData, type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {/* File Upload */}
              <div className="grid gap-2">
                <Label htmlFor="file">File {!editingDocument && '*'}</Label>
                <div className="relative border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer">
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <File className="h-8 w-8 text-muted-foreground" weight="duotone" />
                      <div className="text-left">
                        <p className="font-medium">{selectedFile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedFile(null)}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : editingDocument?.hasFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <File className="h-8 w-8 text-muted-foreground" weight="duotone" />
                      <div className="text-left">
                        <p className="font-medium">{editingDocument.file_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {editingDocument.file_size ? formatFileSize(editingDocument.file_size) : 'Unknown size'}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Select a new file to replace
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <UploadSimple className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Click or drag file to upload
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PDF, Word, Excel, or any document (max 50MB)
                      </p>
                    </div>
                  )}
                  <input
                    type="file"
                    id="file"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={handleFileSelect}
                  />
                </div>
              </div>

              {/* Optional Notes */}
              <div className="grid gap-2">
                <Label htmlFor="content">Notes (optional)</Label>
                <Input
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Add notes or description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSubmit}>
                {editingDocument ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Version History Dialog */}
        <Dialog open={isVersionDialogOpen} onOpenChange={setIsVersionDialogOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Version History</DialogTitle>
              <DialogDescription>
                {editingDocument?.title} - {versions.length} previous versions
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[400px] overflow-y-auto">
              {versions.length === 0 ? (
                <p className="text-center py-4 text-muted-foreground">No previous versions</p>
              ) : (
                <div className="space-y-3">
                  {versions.map((v) => (
                    <div key={v.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <Badge variant="outline">v{v.version}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(v.changed_at)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{v.title}</p>
                      {v.change_summary && (
                        <p className="text-xs text-muted-foreground mt-1">{v.change_summary}</p>
                      )}
                      {v.changed_by && (
                        <p className="text-xs text-muted-foreground mt-1">by @{v.changed_by}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsVersionDialogOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* File Detail Modal */}
        <Dialog
          open={isDetailDialogOpen}
          onOpenChange={(open) => {
            setIsDetailDialogOpen(open);
            if (!open) setViewingDocument(null);
          }}
        >
          <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
            {viewingDocument && (
              <>
                {/* Header with actions */}
                <div className="flex items-start justify-between gap-4 pb-4 border-b">
                  <div className="flex items-start gap-3 min-w-0">
                    {(() => {
                      const FileIcon = getFileTypeIcon(viewingDocument.file_type);
                      return <FileIcon className="h-10 w-10 text-muted-foreground shrink-0" weight="duotone" />;
                    })()}
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold truncate">{viewingDocument.title}</h2>
                      <p className="text-sm text-muted-foreground truncate">
                        {viewingDocument.file_name || 'No file attached'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handlePinFromDetail}
                      title={viewingDocument.pinned ? 'Unpin' : 'Pin'}
                    >
                      <PushPin
                        className={`h-4 w-4 ${viewingDocument.pinned ? 'text-primary' : ''}`}
                        weight={viewingDocument.pinned ? 'fill' : 'regular'}
                      />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleEditFromDetail}
                    >
                      <PencilSimple className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                    {viewingDocument.hasFile && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadFromDetail}
                      >
                        <DownloadSimple className="h-4 w-4 mr-2" />
                        Download
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDeleteFromDetail}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-hidden flex flex-col gap-4 pt-4">
                  {/* File preview section */}
                  {viewingDocument.hasFile && (
                    <div className="flex-1 min-h-0 border rounded-lg overflow-hidden bg-muted/30">
                      {canPreviewFile(viewingDocument.file_type) ? (
                        viewingDocument.file_type?.startsWith('image/') ? (
                          <div className="h-full flex items-center justify-center p-4">
                            <img
                              src={`/api/installations/${currentInstallation?.id}/documents/${viewingDocument.id}/download?inline=true`}
                              alt={viewingDocument.title}
                              className="max-w-full max-h-[400px] object-contain"
                            />
                          </div>
                        ) : viewingDocument.file_type === 'application/pdf' ? (
                          <iframe
                            src={`/api/installations/${currentInstallation?.id}/documents/${viewingDocument.id}/download?inline=true`}
                            className="w-full h-[400px]"
                            title={viewingDocument.title}
                          />
                        ) : null
                      ) : (
                        <div className="h-[200px] flex flex-col items-center justify-center gap-3 text-muted-foreground">
                          {(() => {
                            const FileIcon = getFileTypeIcon(viewingDocument.file_type);
                            return <FileIcon className="h-16 w-16" weight="duotone" />;
                          })()}
                          <p className="text-sm">Preview not available for this file type</p>
                          <Button variant="outline" size="sm" onClick={handleDownloadFromDetail}>
                            <DownloadSimple className="h-4 w-4 mr-2" />
                            Download to view
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Metadata section */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground mb-1">Type</p>
                      <Badge variant="outline">
                        {DOCUMENT_TYPES.find((t) => t.value === viewingDocument.type)?.label || viewingDocument.type}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Status</p>
                      <Badge variant="secondary">
                        {STATUS_OPTIONS.find((s) => s.value === viewingDocument.status)?.label || viewingDocument.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Project</p>
                      <p className="font-medium">{getProjectName(viewingDocument.project_number) || '—'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Version</p>
                      <p className="font-medium">v{viewingDocument.version}</p>
                    </div>
                    {viewingDocument.file_size && (
                      <div>
                        <p className="text-muted-foreground mb-1">File Size</p>
                        <p className="font-medium">{formatFileSize(viewingDocument.file_size)}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-muted-foreground mb-1">Created</p>
                      <p className="font-medium">{formatDate(viewingDocument.created_at)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground mb-1">Modified</p>
                      <p className="font-medium">{formatDate(viewingDocument.updated_at)}</p>
                    </div>
                    {viewingDocument.updated_by && (
                      <div>
                        <p className="text-muted-foreground mb-1">Modified By</p>
                        <p className="font-medium">@{viewingDocument.updated_by}</p>
                      </div>
                    )}
                  </div>

                  {/* Notes section */}
                  {viewingDocument.content && (
                    <div>
                      <p className="text-muted-foreground text-sm mb-2">Notes</p>
                      <p className="text-sm bg-muted/50 rounded-lg p-3">{viewingDocument.content}</p>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <DialogFooter className="pt-4 border-t mt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      fetchVersions(viewingDocument.id);
                      setEditingDocument(viewingDocument);
                      setIsVersionDialogOpen(true);
                    }}
                  >
                    <ClockCounterClockwise className="h-4 w-4 mr-2" />
                    Version History
                  </Button>
                  <Button variant="outline" onClick={() => setIsDetailDialogOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </AppShell.Body>
    </>
  );
}
