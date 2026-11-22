"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import { Extension, type Editor as TiptapEditor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NoteTopicTransfer } from "@/components/note-topic-transfer";
import { ImageLightbox } from "@/components/image-lightbox";
import { NoteImageNodeView } from "@/components/note-image-node-view";
import { OperationStatus, notifyOperation, type OperationStatusKind } from "@/components/operation-status";
import { TextHighlightMark, TextStyleMark } from "@/lib/note-formatting";
import {
  colorPickerValue,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  NOTE_FONT_OPTIONS,
  safeFontFamily,
  safeTextColor,
} from "@/lib/note-formatting-utils";
import { detectTextLanguage, getBidiAttributes } from "@/lib/bidi";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import {
  flushPendingLocalDraftWrites,
  loadLocalNoteDraft,
  removeLocalNoteDraft,
  requestPersistentLocalStorage,
  saveLocalNoteDraft,
  type LocalNoteDraft,
} from "@/lib/local-recovery";
import { ArrowLeft, Bold, ImagePlus, Italic, List, ListOrdered, Pin, Quote, Redo2, Save, Strikethrough, Undo2, Heading1, Heading2, Minus, Trash2 } from "lucide-react";

type Topic = { id: string; title: string };
type Note = { id: string; topicId: string; title: string; subject: string; content: any; tags: string[]; pinned: boolean; updatedAt?: string | Date };
const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

function getEditorStatusKind(message: string): OperationStatusKind {
  const value = message.toLocaleLowerCase();
  if (
    value.includes("fail") ||
    value.includes("could not") ||
    value.includes("error") ||
    value.includes("unavailable") ||
    value.includes("attention") ||
    value.includes("session ended")
  ) return "error";
  if (value.includes("saving") || value.includes("uploading")) return "loading";
  if (value.includes("unsaved") || value.includes("recovered") || value.includes("draft") || value.includes("need saving") || value.includes("preparing")) return "waiting";
  return "success";
}

/**
 * Derive each block's direction from the actual ProseMirror document.
 * Decorations are recalculated after document transactions, including paste,
 * so direction is applied after clipboard content has been normalized and
 * inserted—not by racing or mutating ProseMirror's managed DOM.
 */
const BIDI_NODE_TYPES = ["paragraph", "heading", "blockquote", "listItem", "bulletList", "orderedList"];

const EditableNoteImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(NoteImageNodeView);
  },
});

const BidiDirection = Extension.create({
  name: "bidiDirection",

  /**
   * Store language and direction in the ProseMirror document itself.
   * This makes the direction survive saves, reloads and editor redraws.
   */
  addGlobalAttributes() {
    return [
      {
        types: BIDI_NODE_TYPES,
        attributes: {
          dir: {
            default: null,
            parseHTML: (element) => element.getAttribute("dir"),
            renderHTML: (attributes) => attributes.dir ? { dir: attributes.dir } : {},
          },
          lang: {
            default: null,
            parseHTML: (element) => element.getAttribute("lang"),
            renderHTML: (attributes) => attributes.lang ? { lang: attributes.lang } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((item) => item.docChanged)) return null;
          if (transactions.every((item) => item.getMeta("bidi-normalization"))) return null;

          // Map each changed step range into the final document. This avoids
          // re-reading every paragraph on every keystroke in a long note.
          const changedRanges: Array<{ from: number; to: number }> = [];
          transactions.forEach((item, transactionIndex) => {
            if (!item.docChanged) return;
            let hasMappedRange = false;

            item.mapping.maps.forEach((stepMap, mapIndex) => {
              stepMap.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
                let from = item.mapping.slice(mapIndex + 1).map(newFrom, -1);
                let to = item.mapping.slice(mapIndex + 1).map(newTo, 1);

                for (let laterIndex = transactionIndex + 1; laterIndex < transactions.length; laterIndex += 1) {
                  from = transactions[laterIndex].mapping.map(from, -1);
                  to = transactions[laterIndex].mapping.map(to, 1);
                }

                changedRanges.push({
                  from: Math.max(0, from - 1),
                  to: Math.min(newState.doc.content.size, to + 1),
                });
                hasMappedRange = true;
              });
            });

            // Attribute/mark-only steps can change a block without producing a
            // positional StepMap range. Use that transaction's selection.
            if (!hasMappedRange) {
              let from = item.selection.from;
              let to = item.selection.to;
              for (let laterIndex = transactionIndex + 1; laterIndex < transactions.length; laterIndex += 1) {
                from = transactions[laterIndex].mapping.map(from, -1);
                to = transactions[laterIndex].mapping.map(to, 1);
              }
              changedRanges.push({
                from: Math.max(0, Math.min(from, to) - 1),
                to: Math.min(newState.doc.content.size, Math.max(from, to) + 1),
              });
            }
          });

          if (changedRanges.length === 0) return null;

          const affectedNodes = new Map<number, ProseMirrorNode>();
          for (const range of changedRanges) {
            const from = Math.max(0, Math.min(range.from, newState.doc.content.size));
            const to = Math.min(
              newState.doc.content.size,
              Math.max(from + (from < newState.doc.content.size ? 1 : 0), range.to),
            );
            if (to <= from) continue;

            newState.doc.nodesBetween(from, to, (node, position) => {
              const directionAwareNode =
                node.isTextblock ||
                node.type.name === "blockquote" ||
                node.type.name === "listItem" ||
                node.type.name === "bulletList" ||
                node.type.name === "orderedList";
              if (directionAwareNode && node.textContent.trim()) {
                affectedNodes.set(position, node);
              }
            });
          }

          const transaction = newState.tr;
          let changed = false;
          for (const [position, node] of affectedNodes) {
            // Recalculate from the actual text, overriding incorrect dir/lang
            // values that may have been carried in pasted HTML.
            const { dir, lang } = getBidiAttributes(node.textContent);
            if (node.attrs.dir === dir && node.attrs.lang === lang) continue;

            transaction.setNodeMarkup(
              position,
              undefined,
              { ...node.attrs, dir, lang },
              node.marks,
            );
            changed = true;
          }

          if (!changed) return null;

          // Keep automatic direction metadata out of the user's undo history.
          transaction.setMeta("bidi-normalization", true);
          transaction.setMeta("addToHistory", false);
          return transaction;
        },
      }),
    ];
  },
});

const NOTE_EDITOR_EXTENSIONS = [
  StarterKit,
  TextStyleMark,
  TextHighlightMark,
  BidiDirection,
  EditableNoteImage.configure({ inline: false, allowBase64: false }),
  Placeholder.configure({ placeholder: "Begin with a thought…\n\nWrite freely. Structure can come later." }),
];

export function NoteEditor({ topics, initialNote, defaultTopicId, userId }: { topics: Topic[]; initialNote?: Note; defaultTopicId?: string; userId: string }) {
  const router = useRouter();
  const imageRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [noteId, setNoteId] = useState<string | null>(initialNote?.id ?? null);
  const [topicId, setTopicId] = useState(initialNote?.topicId ?? defaultTopicId ?? topics[0]?.id ?? "");
  const [availableTopics, setAvailableTopics] = useState<Topic[]>(topics);
  const [topicsLoading, setTopicsLoading] = useState(topics.length === 0);
  const [topicsError, setTopicsError] = useState("");
  const [title, setTitle] = useState(initialNote?.title ?? "");
  const [subject, setSubject] = useState(initialNote?.subject ?? "");
  const [tagsInput, setTagsInput] = useState(initialNote?.tags?.join(", ") ?? "");
  const [pinned, setPinned] = useState(initialNote?.pinned ?? false);
  const contentRef = useRef<any>(initialNote?.content ?? EMPTY_DOC);
  const editorRef = useRef<TiptapEditor | null>(null);
  const selectionRef = useRef({ from: 1, to: 1 });
  const changeVersionRef = useRef(0);
  const autosaveRevisionTimerRef = useRef<number | null>(null);
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(initialNote ? "Saved" : "Draft");
  const [recoveryStatus, setRecoveryStatus] = useState("Preparing local recovery…");
  const [draftReady, setDraftReady] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"title" | "subject" | "editor" | "tags" | null>(null);
  const pendingDraftRef = useRef<{ key: string; draft: LocalNoteDraft } | null>(null);
  const recoveryTimerRef = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageSelected, setImageSelected] = useState(false);
  const textColorInputRef = useRef<HTMLInputElement>(null);
  const highlightColorInputRef = useRef<HTMLInputElement>(null);
  const fontFamilySelectRef = useRef<HTMLSelectElement>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);
  const closeImagePreview = useCallback(() => setImagePreview(null), []);
  const draftStorageKey = `user:${userId}:note:${noteId ?? "new"}`;
  const latestDraftFieldsRef = useRef({
    noteId,
    topicId,
    title,
    subject,
    tagsInput,
    pinned,
    focusTarget,
    dirty,
    draftReady,
    serverUpdatedAt: initialNote?.updatedAt ? new Date(initialNote.updatedAt).getTime() : null,
  });
  latestDraftFieldsRef.current = {
    noteId,
    topicId,
    title,
    subject,
    tagsInput,
    pinned,
    focusTarget,
    dirty,
    draftReady,
    serverUpdatedAt: initialNote?.updatedAt ? new Date(initialNote.updatedAt).getTime() : null,
  };

  const scheduleLocalRecovery = useCallback(() => {
    if (recoveryTimerRef.current !== null) return;

    // Keep at most one encrypted recovery write in flight per second while
    // typing, and build the snapshot from refs so cursor movement does not
    // re-render the entire editor.
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = null;
      const latest = latestDraftFieldsRef.current;
      if (!latest.draftReady || !latest.dirty) return;

      const draft: LocalNoteDraft = {
        version: 1,
        noteId: latest.noteId,
        topicId: latest.topicId,
        title: latest.title,
        subject: latest.subject,
        tagsInput: latest.tagsInput,
        pinned: latest.pinned,
        content: editorRef.current?.getJSON() ?? contentRef.current,
        selection: selectionRef.current,
        focusTarget: latest.focusTarget,
        savedAt: Date.now(),
        serverUpdatedAt: latest.serverUpdatedAt,
      };
      const key = `user:${userId}:note:${latest.noteId ?? "new"}`;
      pendingDraftRef.current = { key, draft };
      void saveLocalNoteDraft(key, draft)
        .then(() => setRecoveryStatus("Recovery copy saved on this device"))
        .catch(() => setRecoveryStatus("Local recovery could not be saved"));
    }, 1000);
  }, [userId]);

  const markDirty = useCallback(() => {
    changeVersionRef.current += 1;
    setDirty(true);
    setStatus("Unsaved changes");
    scheduleLocalRecovery();
  }, [scheduleLocalRecovery]);

  const syncFormattingControls = useCallback((current: TiptapEditor) => {
    const textStyle = current.getAttributes("textStyle") as {
      color?: unknown;
      fontFamily?: unknown;
    };
    const highlight = current.getAttributes("textHighlight") as { color?: unknown };

    if (textColorInputRef.current) {
      textColorInputRef.current.value = colorPickerValue(textStyle.color, DEFAULT_TEXT_COLOR);
    }
    if (highlightColorInputRef.current) {
      highlightColorInputRef.current.value = colorPickerValue(highlight.color, DEFAULT_HIGHLIGHT_COLOR);
    }
    if (fontFamilySelectRef.current) {
      fontFamilySelectRef.current.value = safeFontFamily(textStyle.fontFamily) ?? "";
    }
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: NOTE_EDITOR_EXTENSIONS,
    content: initialNote?.content ?? EMPTY_DOC,
    editorProps: {
      attributes: { class: "rich-editor", spellcheck: "true", "aria-label": "Note content", dir: "ltr" },
    },
    onCreate: ({ editor: current }) => {
      // Normalize older saved documents immediately, without requiring the
      // user to edit or re-paste their existing Urdu content.
      current.view.dispatch(current.state.tr.setMeta("bidi-initial-normalization", true));
      editorRef.current = current;
      contentRef.current = current.getJSON();
      syncFormattingControls(current);
    },
    onUpdate: ({ editor: current, transaction }) => {
      // Do not serialize the entire document on every keystroke. Create JSON
      // snapshots only when a save or recovery checkpoint is due.
      editorRef.current = current;
      syncFormattingControls(current);
      if (transaction.getMeta("bidi-normalization")) return;

      markDirty();
      // Debounce the React autosave trigger instead of putting the full
      // ProseMirror JSON tree into React state on every keystroke.
      if (autosaveRevisionTimerRef.current !== null) {
        window.clearTimeout(autosaveRevisionTimerRef.current);
      }
      autosaveRevisionTimerRef.current = window.setTimeout(() => {
        autosaveRevisionTimerRef.current = null;
        setAutosaveRevision((revision) => revision + 1);
      }, 500);
    },
    onSelectionUpdate: ({ editor: current }) => {
      setImageSelected(current.isActive("image"));
      const currentSelection = current.state.selection;
      selectionRef.current = { from: currentSelection.from, to: currentSelection.to };
      syncFormattingControls(current);
    },
  });

  useEffect(() => {
    editor?.setEditable(!busy && !imageUploading);
  }, [editor, busy, imageUploading]);

  // Fetch destination labels after the editor mounts, in bounded pages.
  useEffect(() => {
    if (topics.length > 0) return;
    const controller = new AbortController();
    let cancelled = false;
    setTopicsLoading(true);
    setTopicsError("");

    async function loadAllTopicOptions() {
      const collected: Topic[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore && !controller.signal.aborted) {
        const response = await fetch(`/api/topics/options?limit=200&offset=${offset}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load topics.");
        const valid: Topic[] = Array.isArray(data.topics)
          ? data.topics.filter((item: unknown): item is Topic =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as Topic).id === "string" &&
              typeof (item as Topic).title === "string",
            )
          : [];
        collected.push(...valid);
        hasMore = data.pagination?.hasMore === true;
        offset += Number.isSafeInteger(data.pagination?.limit) && data.pagination.limit > 0
          ? data.pagination.limit
          : 200;
      }
      if (cancelled || controller.signal.aborted) return;
      setAvailableTopics(collected);
      if (!collected.some((topic) => topic.id === topicId) && collected[0]) {
        setTopicId(collected[0].id);
      }
    }

    void loadAllTopicOptions()
      .catch((cause) => {
        if (!cancelled && !controller.signal.aborted) {
          setTopicsError(cause instanceof Error ? cause.message : "Could not load topics.");
        }
      })
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [topics]);

  // Synchronize uncontrolled formatting inputs after they mount and whenever
  // the editor instance changes. Selection changes keep these refs current.
  useEffect(() => {
    if (editor) syncFormattingControls(editor);
  }, [editor, syncFormattingControls]);

  // Ask the browser to retain this origin's IndexedDB data when supported.
  useEffect(() => {
    void requestPersistentLocalStorage();
  }, []);

  // Restore a newer local draft before enabling autosave. The copy is encrypted
  // with a non-extractable device key and never placed in localStorage.
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    setDraftReady(false);
    loadLocalNoteDraft(draftStorageKey)
      .then((draft) => {
        if (cancelled || !draft) return;
        const serverUpdatedAt = initialNote?.updatedAt
          ? new Date(initialNote.updatedAt).getTime()
          : 0;
        const isNewerThanServer = !initialNote || draft.savedAt > serverUpdatedAt;
        if (!isNewerThanServer) {
          void removeLocalNoteDraft(draftStorageKey).catch(() => undefined);
          return;
        }

        setTopicId(draft.topicId || initialNote?.topicId || defaultTopicId || topics[0]?.id || "");
        setTitle(draft.title);
        setSubject(draft.subject);
        setTagsInput(draft.tagsInput);
        setPinned(draft.pinned);
        contentRef.current = draft.content;
        editor.commands.setContent(draft.content as any, { emitUpdate: false });
        const maxPosition = editor.state.doc.content.size;
        const from = Math.max(1, Math.min(draft.selection?.from ?? 1, maxPosition));
        const to = Math.max(from, Math.min(draft.selection?.to ?? from, maxPosition));
        editor.commands.setTextSelection({ from, to });
        selectionRef.current = { from, to };
        setFocusTarget(draft.focusTarget ?? null);
        requestAnimationFrame(() => {
          if (draft.focusTarget === "title") {
            document.getElementById("note-title")?.focus({ preventScroll: true });
          } else if (draft.focusTarget === "subject") {
            document.getElementById("note-subject")?.focus({ preventScroll: true });
          } else if (draft.focusTarget === "tags") {
            document.getElementById("note-tags")?.focus({ preventScroll: true });
          } else if (draft.focusTarget === "editor") {
            editor.view.dom.focus({ preventScroll: true });
            editor.commands.setTextSelection({ from, to });
          }
        });
        setDirty(true);
        setStatus("Recovered unsaved changes");
        setRecoveryStatus("Recovered from this device");
      })
      .catch(() => {
        if (!cancelled) setRecoveryStatus("Local recovery is unavailable");
      })
      .finally(() => {
        if (!cancelled) setDraftReady(true);
      });
    return () => { cancelled = true; };
  }, [editor, draftStorageKey, initialNote?.updatedAt, defaultTopicId, topics]);

  // Metadata changes schedule recovery too; document edits and cursor
  // updates are handled through refs without forcing component renders.
  useEffect(() => {
    if (!draftReady || !dirty) return;
    scheduleLocalRecovery();
  }, [draftReady, dirty, noteId, topicId, title, subject, tagsInput, pinned, focusTarget, scheduleLocalRecovery]);

  // Flush a final local snapshot when the tab is hidden or closed. The
  // frequent IndexedDB writes above remain the primary power-loss protection.
  useEffect(() => {
    const recoveryIsPending =
      dirty ||
      recoveryStatus === "Saving recovery copy…" ||
      recoveryStatus === "Recovery copy saved on this device" ||
      recoveryStatus === "Recovered from this device" ||
      recoveryStatus === "Local recovery could not be saved";
    if (!draftReady || !recoveryIsPending) return;
    const flush = () => {
      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      const draft: LocalNoteDraft = {
        version: 1,
        noteId,
        topicId,
        title,
        subject,
        tagsInput,
        pinned,
        content: editorRef.current?.getJSON() ?? contentRef.current,
        selection: selectionRef.current,
        focusTarget,
        savedAt: Date.now(),
        serverUpdatedAt: initialNote?.updatedAt ? new Date(initialNote.updatedAt).getTime() : null,
      };
      pendingDraftRef.current = { key: draftStorageKey, draft };
      void saveLocalNoteDraft(draftStorageKey, draft)
        .then(() => setRecoveryStatus("Recovery copy saved on this device"))
        .catch(() => setRecoveryStatus("Local recovery could not be saved"));
      void flushPendingLocalDraftWrites();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("mnemosyne:flush-local-drafts", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("mnemosyne:flush-local-drafts", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [draftReady, dirty, recoveryStatus, draftStorageKey, noteId, topicId, title, subject, tagsInput, pinned, focusTarget, initialNote?.updatedAt]);

  const save = useCallback(async (
    quiet = false,
    options: { navigateOnCreate?: boolean; refreshOnSave?: boolean } = {},
  ): Promise<string | null> => {
    if (!topicId) { setError("Create a topic before writing a note."); return null; }
    if (!title.trim()) { if (!quiet) setError("Give your note a title before saving."); return null; }
    if (savingRef.current) return noteId;
    const savedVersion = changeVersionRef.current;
    const showBusyState = !quiet;
    savingRef.current = true;
    if (showBusyState) setBusy(true);
    if (!quiet) setError("");
    setStatus(quiet ? "Saving in background…" : "Saving…");
    try {
      const currentContent = editorRef.current?.getJSON() ?? contentRef.current;
      contentRef.current = currentContent;
      const payload = { topicId, title, subject, content: currentContent, tags: tagsInput.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean).slice(0, 30), pinned };
      const response = await fetch(noteId ? `/api/notes/${noteId}` : "/api/notes", {
        method: noteId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setStatus("Vault session ended. Returning to unlock…");
        return null;
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save note.");
      const savedId = noteId ?? data.note.id;
      const savedDraftKey = `user:${userId}:note:${noteId ?? "new"}`;
      if (!noteId) {
        setNoteId(savedId);
        if (options.navigateOnCreate !== false) {
          router.replace(`/notes/${savedId}/edit`);
        }
      } else if (
        options.navigateOnCreate !== false &&
        window.location.pathname === "/notes/new"
      ) {
        // A new note may have been created without navigation so an image can
        // be attached to this same editor instance. Move to its edit URL after
        // the next successful save.
        router.replace(`/notes/${savedId}/edit`);
      }
      // Background saves do not stop typing. Only clear the recovery copy
      // when no newer edit happened while this request was in flight.
      if (savedVersion === changeVersionRef.current) {
        if (recoveryTimerRef.current !== null) {
          window.clearTimeout(recoveryTimerRef.current);
          recoveryTimerRef.current = null;
        }
        pendingDraftRef.current = null;
        setDirty(false);
        setStatus("All changes saved");
        setRecoveryStatus("Saved securely to your archive");
        await removeLocalNoteDraft(savedDraftKey).catch(() => undefined);
      } else {
        setDirty(true);
        setStatus("Newer changes still need saving");
        scheduleLocalRecovery();
        setAutosaveRevision((revision) => revision + 1);
      }
      if (options.refreshOnSave !== false) router.refresh();
      return savedId;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save note.";
      if (message === "Please unlock your vault.") {
        setStatus("Vault session ended. Returning to unlock…");
      } else {
        if (!quiet) {
          setError(message);
        }
        setStatus(quiet ? "Autosave failed; local recovery is retained" : "Save failed");
      }
      // Do not clear dirty state on failure: the latest version remains
      // eligible for local recovery and can be retried.
      setDirty(true);
      return null;
    } finally {
      savingRef.current = false;
      if (showBusyState) setBusy(false);
    }
  }, [topicId, title, subject, tagsInput, pinned, noteId, router, scheduleLocalRecovery]);

  useEffect(() => {
    // Image upload performs its own immediate document PATCH. Do not run the
    // background autosave concurrently with that upload/save sequence.
    if (!noteId || !dirty || busy || imageUploading) return;
    const timer = setTimeout(() => { void save(true, { refreshOnSave: false }); }, 1100);
    return () => clearTimeout(timer);
  }, [noteId, dirty, title, subject, topicId, tagsInput, pinned, autosaveRevision, save, busy, imageUploading]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function uploadImages(files: File[], dropPosition?: number) {
    if (imageUploading || busy || files.length === 0) return;
    if (!editor) {
      setError("The note editor is not ready yet. Try again in a moment.");
      return;
    }

    const supportedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const validFiles: File[] = [];
    const failures: string[] = [];

    for (const file of files) {
      const supportedByName = /\.(png|jpe?g|webp|gif)$/i.test(file.name);
      if (!supportedTypes.includes(file.type) && !supportedByName) {
        failures.push(file.name + ": unsupported format");
        continue;
      }
      if (file.size === 0) {
        failures.push(file.name + ": file is empty");
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        failures.push(file.name + ": larger than 20 MB");
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      setError(failures.join("; ") || "Choose one or more supported images.");
      return;
    }

    // Capture the exact editor selection before the file picker/upload flow.
    // The editor stays read-only while files are sent, so this range remains
    // stable and the whole batch can be inserted in one ProseMirror transaction.
    const insertionRange = dropPosition === undefined
      ? {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
        }
      : {
          from: Math.max(1, Math.min(dropPosition, editor.state.doc.content.size)),
          to: Math.max(1, Math.min(dropPosition, editor.state.doc.content.size)),
        };

    setError(failures.length ? failures.join("; ") : "");
    setImageUploading(true);
    let id = noteId;
    const shouldNavigateToEdit = window.location.pathname === "/notes/new";
    const uploadedAssets: Array<{ file: File; url: string }> = [];
    let insertedCount = 0;
    let updatedContent: any = null;

    try {
      // Create a new note in place first. Do not navigate away while the
      // selected image files are uploading and being inserted.
      if (!id) id = await save(false, { navigateOnCreate: false, refreshOnSave: false });
      if (!id) return;

      // Upload sequentially to avoid simultaneous large requests and make
      // individual failures recoverable without cancelling the other files.
      for (let index = 0; index < validFiles.length; index += 1) {
        const file = validFiles[index];
        setStatus("Uploading image " + (index + 1) + " of " + validFiles.length + "…");

        try {
          const form = new FormData();
          form.append("file", file, file.name);
          const response = await fetch("/api/notes/" + id + "/assets", {
            method: "POST",
            body: form,
            credentials: "same-origin",
          });
          if (response.status === 401) {
            setStatus("Vault session ended. Returning to unlock…");
            return;
          }
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error || "Upload failed (HTTP " + response.status + ").");
          }
          if (typeof data?.asset?.url !== "string" || !/^\/api\/assets\/[0-9a-f-]{36}$/i.test(data.asset.url)) {
            throw new Error("The server did not return a valid uploaded image address.");
          }

          uploadedAssets.push({ file, url: data.asset.url });
        } catch (error) {
          failures.push(file.name + ": " + (error instanceof Error ? error.message : "upload failed"));
        }
      }

      if (uploadedAssets.length === 0) {
        setError(failures.join("; ") || "No images could be uploaded.");
        setStatus("Upload failed");
        return;
      }

      // Insert the complete batch in one editor transaction. This avoids
      // repeatedly changing ProseMirror's editable state and selection while
      // uploads are still running.
      const imageNodes = uploadedAssets.map(({ file, url }) => ({
        type: "image",
        attrs: { src: url, alt: file.name },
      }));
      const inserted = editor.commands.insertContentAt(insertionRange, imageNodes, {
        updateSelection: true,
      });

      if (!inserted) {
        await Promise.all(uploadedAssets.map(({ url }) =>
          fetch(url, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined),
        ));
        throw new Error("The uploaded images could not be inserted into the note.");
      }

      insertedCount = uploadedAssets.length;
      updatedContent = editor.getJSON();
      contentRef.current = updatedContent;
      setStatus("Saving " + insertedCount + " " + (insertedCount === 1 ? "image" : "images") + " to note…");

      // Save the complete document once after all successful uploads.
      setBusy(true);
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
        .slice(0, 30);
      const saveResponse = await fetch("/api/notes/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          topicId,
          title,
          subject,
          content: updatedContent,
          tags,
          pinned,
        }),
      });
      if (saveResponse.status === 401) {
        setStatus("Vault session ended. Returning to unlock…");
        return;
      }
      const saveData = await saveResponse.json().catch(() => null);

      if (!saveResponse.ok) {
        // Commit a local encrypted recovery copy before reporting failure.
        await saveLocalNoteDraft(`user:${userId}:note:${id}`, {
          version: 1,
          noteId: id,
          topicId,
          title,
          subject,
          tagsInput,
          pinned,
          content: updatedContent,
          selection: selectionRef.current,
          focusTarget,
          savedAt: Date.now(),
          serverUpdatedAt: initialNote?.updatedAt ? new Date(initialNote.updatedAt).getTime() : null,
        }).catch(() => undefined);
        throw new Error(saveData?.error || "Images uploaded, but the note could not be updated. Your recovery copy has been kept.");
      }

      if (recoveryTimerRef.current !== null) {
        window.clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      pendingDraftRef.current = null;
      setDirty(false);
      setStatus("All changes saved");
      setRecoveryStatus("Saved securely to your archive");
      await Promise.all([
        removeLocalNoteDraft(`user:${userId}:note:new`).catch(() => undefined),
        removeLocalNoteDraft(`user:${userId}:note:${id}`).catch(() => undefined),
      ]);

      if (shouldNavigateToEdit) {
        router.replace("/notes/" + id + "/edit");
        router.refresh();
      }

      if (failures.length > 0) {
        setError(insertedCount + " image(s) added. Some files were skipped: " + failures.join("; "));
      } else {
        setError("");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Image upload failed.";
      if (message === "Please unlock your vault.") {
        setStatus("Vault session ended. Returning to unlock…");
      } else {
        setError(message);
        setStatus(insertedCount > 0 ? "Images added; save needs attention" : "Upload failed");
      }
      if (insertedCount > 0) setDirty(true);
    } finally {
      setBusy(false);
      setImageUploading(false);
    }
  }

  function removeSelectedImage() {
    if (!editor || !editor.isActive("image")) return;
    // Remove the image from the document first. The next successful note PATCH
    // invokes deleteUnreferencedNoteAssets(), so storage is cleaned only after
    // the updated document has been persisted successfully.
    editor.chain().focus().deleteSelection().run();
  }

  async function removeNote() {
    if (!noteId || busy || imageUploading || !confirm("Move this note to Recently deleted? You can restore it later.")) return;

    setBusy(true);
    setError("");
    setStatus("Moving note to Recently deleted…");
    try {
      const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not move this note to Recently deleted.");

      void removeLocalNoteDraft(`user:${userId}:note:${noteId}`).catch(() => undefined);
      notifyOperation("success", "Note moved to Recently deleted.");
      router.push("/notes");
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not move this note to Recently deleted.";
      setError(message);
      setStatus("Move to Trash failed");
    } finally {
      setBusy(false);
    }
  }

  function hasExternalFiles(dataTransfer: DataTransfer): boolean {
    return Array.from(dataTransfer.types).includes("Files");
  }

  function handleEditorDragEnter(event: React.DragEvent<HTMLDivElement>) {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    setIsImageDragActive(true);
  }

  function handleEditorDragOver(event: React.DragEvent<HTMLDivElement>) {
    if (!hasExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy || imageUploading ? "none" : "copy";
    if (!busy && !imageUploading) setIsImageDragActive(true);
  }

  function handleEditorDragLeave(event: React.DragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsImageDragActive(false);
  }

  function handleEditorDrop(event: React.DragEvent<HTMLDivElement>) {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    event.preventDefault();
    event.stopPropagation();
    setIsImageDragActive(false);

    if (busy || imageUploading) {
      setError("Wait for the current save or image upload to finish before dropping more images.");
      return;
    }

    const dropPosition = editor?.view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    })?.pos;
    void uploadImages(files, dropPosition);
  }

  const words = (editor?.getText() ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (!availableTopics.length && !topicsLoading) {
    return (
      <main className="page">
        <div className="empty-state">
          <h3>{topicsError ? "Could not load your topics" : "Create a topic first"}</h3>
          <p>{topicsError || "Every note belongs to a topic. Create a collection, then come back to write."}</p>
          <Link href="/topics" className="primary-btn">Go to topics</Link>
        </div>
      </main>
    );
  }

  return <main className="page"><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:25 }}><Link href={noteId ? `/notes/${noteId}` : "/notes"} className="breadcrumb"><ArrowLeft size={14}/> {noteId ? "Back to note" : "All notes"}</Link><div style={{ display:"flex", gap:8 }}><OperationStatus kind={getEditorStatusKind(status)} message={status} compact /><button className="primary-btn" onClick={() => void save(false)} disabled={busy || imageUploading || !title.trim()} title={!title.trim() ? "Enter a note title before saving." : "Save note"}><Save size={14}/>{busy ? "Saving…" : "Save note"}</button></div></div>
    <div className="note-layout"><section className="editor-main"><div className="eyebrow">{noteId ? "Refine your thinking" : "A new inscription"}</div><input id="note-title" onFocus={() => setFocusTarget("title")} dir="auto" lang={detectTextLanguage(title)} className="editor-title" value={title} onChange={(e) => { setTitle(e.target.value); markDirty(); }} placeholder="Untitled note" maxLength={180} disabled={busy || imageUploading} aria-label="Note title"/><input id="note-subject" onFocus={() => setFocusTarget("subject")} dir="auto" lang={detectTextLanguage(subject)} className="editor-subject" value={subject} onChange={(e) => { setSubject(e.target.value); markDirty(); }} placeholder="Add a subject or a quiet subtitle…" maxLength={180} disabled={busy || imageUploading} aria-label="Note subject"/>
      <div className="editor-toolbar" role="toolbar" aria-label="Text formatting"><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("bold") ? "active" : ""}`} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"><Bold/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("italic") ? "active" : ""}`} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"><Italic/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("strike") ? "active" : ""}`} onClick={() => editor?.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough/></button><span className="tool-divider"/><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("heading",{level:1})?"active":""}`} onClick={() => editor?.chain().focus().toggleHeading({level:1}).run()} title="Heading 1"><Heading1/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("heading",{level:2})?"active":""}`} onClick={() => editor?.chain().focus().toggleHeading({level:2}).run()} title="Heading 2"><Heading2/></button><span className="tool-divider"/><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("bulletList")?"active":""}`} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bulleted list"><List/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("orderedList")?"active":""}`} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("blockquote")?"active":""}`} onClick={() => editor?.chain().focus().toggleBlockquote().run()} title="Quote"><Quote/></button><button disabled={busy || imageUploading} className="tool-btn" onClick={() => editor?.chain().focus().setHorizontalRule().run()} title="Divider"><Minus/></button><span className="tool-divider"/><input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={!editor || busy || imageUploading} onChange={(e) => { const files=Array.from(e.currentTarget.files ?? []); e.currentTarget.value=""; if(files.length)void uploadImages(files); }}/><button disabled={!editor || busy || imageUploading} className="tool-btn" onClick={() => imageRef.current?.click()} title={imageUploading ? "Uploading images…" : "Add images"}><ImagePlus/></button><button disabled={busy || imageUploading || !imageSelected} className="tool-btn" onClick={() => void removeSelectedImage()} title="Remove selected image"><Trash2/></button><span className="tool-divider"/><button disabled={busy || imageUploading} className="tool-btn" onClick={() => editor?.chain().focus().undo().run()} title="Undo"><Undo2/></button><button disabled={busy || imageUploading} className="tool-btn" onClick={() => editor?.chain().focus().redo().run()} title="Redo"><Redo2/></button></div>
      <div className="editor-formatting-controls" role="group" aria-label="Text appearance">
        <label className="inline-format-control">
          <span>Font</span>
          <select
            ref={fontFamilySelectRef}
            aria-label="Selected text font"
            defaultValue=""
            disabled={!editor || busy || imageUploading}
            onChange={(event) => {
              if (!editor) return;
              const current = editor.getAttributes("textStyle") as { color?: unknown; fontFamily?: unknown };
              editor.chain().focus().setMark("textStyle", {
                ...current,
                fontFamily: event.currentTarget.value || null,
              }).run();
              markDirty();
              syncFormattingControls(editor);
            }}
          >
            <option value="">Default font</option>
            {NOTE_FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value}>{font.label}</option>
            ))}
          </select>
        </label>
        <label className="inline-format-control">
          <span>Text color</span>
          <input
            ref={textColorInputRef}
            type="color"
            aria-label="Text color"
            defaultValue={DEFAULT_TEXT_COLOR}
            disabled={!editor || busy || imageUploading}
            onChange={(event) => {
              if (!editor) return;
              const current = editor.getAttributes("textStyle") as { color?: unknown; fontFamily?: unknown };
              editor.chain().focus().setMark("textStyle", {
                ...current,
                color: event.currentTarget.value,
              }).run();
              markDirty();
              syncFormattingControls(editor);
            }}
          />
        </label>
        <label className="inline-format-control">
          <span>Highlight</span>
          <input
            ref={highlightColorInputRef}
            type="color"
            aria-label="Highlight color"
            defaultValue={DEFAULT_HIGHLIGHT_COLOR}
            disabled={!editor || busy || imageUploading}
            onChange={(event) => {
              if (!editor) return;
              editor.chain().focus().setMark("textHighlight", {
                color: event.currentTarget.value,
              }).run();
              markDirty();
              syncFormattingControls(editor);
            }}
          />
        </label>
        <button
          type="button"
          className="format-reset-btn"
          disabled={!editor || busy || imageUploading}
          onClick={() => {
            editor?.chain().focus().unsetMark("textStyle").unsetMark("textHighlight").run();
            if (editor) {
              markDirty();
              syncFormattingControls(editor);
            }
          }}
          title="Remove text color, font and highlight from the selection"
        >
          Clear formatting
        </button>
      </div>
      <div
        className={isImageDragActive ? "note-image-dropzone note-image-dropzone-active" : "note-image-dropzone"}
        onDragEnterCapture={handleEditorDragEnter}
        onDragOverCapture={handleEditorDragOver}
        onDragLeaveCapture={handleEditorDragLeave}
        onDropCapture={handleEditorDrop}
      >
        <EditorContent
          editor={editor}
          onFocusCapture={() => setFocusTarget("editor")}
          onClickCapture={(event) => {
            const target = event.target;
            if (!(target instanceof HTMLImageElement)) return;
            const src = target.getAttribute("src") ?? "";
            if (!/^\/api\/assets\/[0-9a-f-]{36}$/i.test(src)) return;
            // Keep ProseMirror's normal click handling so the image remains
            // selectable for editing, while opening its full-size preview here.
            setImagePreview({ src, alt: target.alt || "Note image" });
          }}
        />
        {isImageDragActive && <div className="note-image-drop-overlay" aria-hidden="true">
          <div className="note-image-drop-message">
            <ImagePlus size={25}/>
            <strong>Drop images to insert</strong>
            <span>Single or multiple images · PNG, JPG, WebP or GIF</span>
          </div>
        </div>}
      </div>
      <ImageLightbox
        src={imagePreview?.src ?? null}
        alt={imagePreview?.alt ?? "Note image"}
        onClose={closeImagePreview}
      />
      <div className="editor-footer"><span>{words} words</span><OperationStatus kind={getEditorStatusKind(recoveryStatus)} message={recoveryStatus} compact /><span>Private encrypted note</span></div>
    </section><aside className="editor-side"><section className="panel"><h3 className="panel-title">Note properties</h3><div className="property-block"><div className="property-label">Belongs to</div><select dir="auto" lang={detectTextLanguage(availableTopics.find((topic) => topic.id === topicId)?.title ?? "")} className="select-field" value={topicId} disabled={busy || imageUploading} onChange={(e)=>{setTopicId(e.target.value);markDirty();}}>{availableTopics.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select>{topicsLoading && <span className="form-hint">Loading topics…</span>}{topicsError && <span className="form-hint">{topicsError}</span>}</div><div className="property-block"><div className="property-label">Tags</div><input id="note-tags" onFocus={() => setFocusTarget("tags")} dir="auto" lang={detectTextLanguage(tagsInput)} className="field" value={tagsInput} disabled={busy || imageUploading} onChange={(e)=>{setTagsInput(e.target.value);markDirty();}} placeholder="philosophy, research…"/><p className="form-hint">Separate tags with commas.</p></div><button className={`secondary-btn`} disabled={busy || imageUploading} style={{ width:"100%", justifyContent:"flex-start" }} onClick={()=>{setPinned(!pinned);markDirty();}}><Pin size={14}/>{pinned?"Remove from pinned":"Pin this note"}</button>{noteId&&<div style={{marginTop:10}}><NoteTopicTransfer noteId={noteId} currentTopicId={topicId} topics={availableTopics.length ? availableTopics : undefined} beforeTransfer={async()=>{if(busy || imageUploading)return false;return dirty?Boolean(await save(false)):true;}}/></div>}</section><section className="panel"><div className="property-label">Writing guidance</div><p className="form-hint" style={{fontSize:10,lineHeight:1.8}}>Use headings to create structure. Add quotations for source passages. Place images inline where they add context to the note.</p></section>{noteId&&<button className="danger-btn" onClick={removeNote} disabled={busy || imageUploading}><Trash2 size={14}/> Move to Trash</button>}</aside></div>{error&&<OperationStatus kind="error" message={error} />}</main>;
}
