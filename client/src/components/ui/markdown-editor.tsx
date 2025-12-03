import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { cn } from '@jybrd/design-system/lib/utils';
import { Button } from '@jybrd/design-system/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@jybrd/design-system/components/ui/dropdown-menu';
import {
  TextHOne,
  TextHTwo,
  TextHThree,
  TextB,
  TextItalic,
  Quotes,
  Code,
  Link as LinkIcon,
  ListBullets,
  ListNumbers,
  ListChecks,
  CaretDown,
  Paragraph,
} from '@phosphor-icons/react';

import './markdown-editor.css';

interface MarkdownEditorProps {
  value?: string;
  onChange?: (markdown: string) => void;
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  value = '',
  onChange,
  placeholder = 'Write something...',
  className,
}: MarkdownEditorProps) {
  // Track if update is from internal editing to prevent feedback loops
  const isInternalUpdate = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Markdown,
      Link.configure({
        openOnClick: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: value,
    contentType: 'markdown',
    editorProps: {
      attributes: {
        class: 'tiptap-editor',
      },
    },
    onUpdate: ({ editor }) => {
      if (onChange) {
        isInternalUpdate.current = true;
        const markdown = editor.getMarkdown();
        onChange(markdown);
      }
    },
  });

  useEffect(() => {
    // Skip syncing if the update came from internal editing
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    if (editor && value !== editor.getMarkdown()) {
      editor.commands.setContent(value, { contentType: 'markdown' });
    }
  }, [editor, value]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('URL');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  // Refocus editor after dropdown closes
  const refocusEditor = useCallback(() => {
    setTimeout(() => {
      editor?.commands.focus();
    }, 0);
  }, [editor]);

  const getCurrentHeadingLevel = () => {
    if (!editor) return null;
    if (editor.isActive('heading', { level: 1 })) return 1;
    if (editor.isActive('heading', { level: 2 })) return 2;
    if (editor.isActive('heading', { level: 3 })) return 3;
    return null;
  };

  if (!editor) {
    return null;
  }

  const headingLevel = getCurrentHeadingLevel();

  return (
    <div className={cn('border rounded-md overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center border-b bg-muted/30 px-2 py-1">
        {/* Heading dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('h-7 px-2 gap-1', headingLevel && 'bg-muted')}
            >
              {(() => {
                switch (headingLevel) {
                  case 1: return <TextHOne className="h-4 w-4" />;
                  case 2: return <TextHTwo className="h-4 w-4" />;
                  case 3: return <TextHThree className="h-4 w-4" />;
                  default: return <Paragraph className="h-4 w-4" />;
                }
              })()}
              <CaretDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem
              onClick={() => {
                editor.chain().focus().setParagraph().run();
                refocusEditor();
              }}
              className={cn(!headingLevel && 'bg-muted')}
            >
              <Paragraph className="h-4 w-4 mr-2" />
              Normal text
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                editor.chain().focus().toggleHeading({ level: 1 }).run();
                refocusEditor();
              }}
              className={cn(headingLevel === 1 && 'bg-muted')}
            >
              <TextHOne className="h-4 w-4 mr-2" />
              Heading 1
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                editor.chain().focus().toggleHeading({ level: 2 }).run();
                refocusEditor();
              }}
              className={cn(headingLevel === 2 && 'bg-muted')}
            >
              <TextHTwo className="h-4 w-4 mr-2" />
              Heading 2
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                editor.chain().focus().toggleHeading({ level: 3 }).run();
                refocusEditor();
              }}
              className={cn(headingLevel === 3 && 'bg-muted')}
            >
              <TextHThree className="h-4 w-4 mr-2" />
              Heading 3
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('bold') && 'bg-muted')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <TextB className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('italic') && 'bg-muted')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <TextItalic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('code') && 'bg-muted')}
          onClick={() => editor.chain().focus().toggleCode().run()}
          title="Code"
        >
          <Code className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('link') && 'bg-muted')}
          onClick={addLink}
          title="Link"
        >
          <LinkIcon className="h-4 w-4" />
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('blockquote') && 'bg-muted')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          title="Quote"
        >
          <Quotes className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('bulletList') && 'bg-muted')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bulleted list"
        >
          <ListBullets className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('orderedList') && 'bg-muted')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
        >
          <ListNumbers className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('h-7 w-7 p-0', editor.isActive('taskList') && 'bg-muted')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          title="Task list"
        >
          <ListChecks className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} className="markdown-editor-content" />
    </div>
  );
}
