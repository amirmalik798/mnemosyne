"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { NoteTopicTransfer } from "@/components/note-topic-transfer";
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

/**
 * Derive each block's direction from the actual ProseMirror document.
 * Decorations are recalculated after document transactions, including paste,
 * so direction is applied after clipboard content has been normalized and
 * inserted—not by racing or mutating ProseMirror's managed DOM.
 */
const BIDI_NODE_TYPES = ["paragraph", "heading", "blockquote", "listItem", "bulletList", "orderedList"];

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
        appendTransaction(_transactions, _oldState, newState) {
          const transaction = newState.tr;
          let changed = false;

          newState.doc.descendants((node, position) => {
            const directionAwareNode =
              node.isTextblock ||
              node.type.name === "blockquote" ||
              node.type.name === "listItem" ||
              node.type.name === "bulletList" ||
              node.type.name === "orderedList";

            if (!directionAwareNode) return;

            const text = node.textContent;
            if (!text.trim()) return;

            // Recalculate from the actual text, overriding incorrect dir/lang
            // values that may have been carried in pasted HTML.
            const { dir, lang } = getBidiAttributes(text);
            if (node.attrs.dir === dir && node.attrs.lang === lang) return;

            transaction.setNodeMarkup(
              position,
              undefined,
              { ...node.attrs, dir, lang },
              node.marks,
            );
            changed = true;
          });

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

export function NoteEditor({ topics, initialNote, defaultTopicId }: { topics: Topic[]; initialNote?: Note; defaultTopicId?: string }) {
  const router = useRouter();
  const imageRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [noteId, setNoteId] = useState<string | null>(initialNote?.id ?? null);
  const [topicId, setTopicId] = useState(initialNote?.topicId ?? defaultTopicId ?? topics[0]?.id ?? "");
  const [title, setTitle] = useState(initialNote?.title ?? "");
  const [subject, setSubject] = useState(initialNote?.subject ?? "");
  const [tagsInput, setTagsInput] = useState(initialNote?.tags?.join(", ") ?? "");
  const [pinned, setPinned] = useState(initialNote?.pinned ?? false);
  const [content, setContent] = useState<any>(initialNote?.content ?? EMPTY_DOC);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(initialNote ? "Saved" : "Draft");
  const [recoveryStatus, setRecoveryStatus] = useState("Preparing local recovery…");
  const [draftReady, setDraftReady] = useState(false);
  const [selection, setSelection] = useState({ from: 1, to: 1 });
  const [focusTarget, setFocusTarget] = useState<"title" | "subject" | "editor" | "tags" | null>(null);
  const pendingDraftRef = useRef<{ key: string; draft: LocalNoteDraft } | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageSelected, setImageSelected] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const draftStorageKey = noteId ? `note:${noteId}` : "note:new";
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, BidiDirection, Image.configure({ inline: false, allowBase64: false }), Placeholder.configure({ placeholder: "Begin with a thought…\n\nWrite freely. Structure can come later." })],
    content: initialNote?.content ?? EMPTY_DOC,
    editorProps: {
      attributes: { class: "rich-editor", spellcheck: "true", "aria-label": "Note content", dir: "ltr" },
    },
    onCreate: ({ editor: current }) => {
      // Normalize older saved documents immediately, without requiring the
      // user to edit or re-paste their existing Urdu content.
      current.view.dispatch(current.state.tr.setMeta("bidi-initial-normalization", true));
      setContent(current.getJSON());
    },
    onUpdate: ({ editor: current, transaction }) => {
      setContent(current.getJSON());
      if (transaction.getMeta("bidi-normalization")) return;
      setDirty(true);
      setStatus("Unsaved changes");
    },
    onSelectionUpdate: ({ editor: current }) => {
      setImageSelected(current.isActive("image"));
      const currentSelection = current.state.selection;
      setSelection({ from: currentSelection.from, to: currentSelection.to });
    },
  });

  useEffect(() => {
    editor?.setEditable(!busy && !imageUploading);
  }, [editor, busy, imageUploading]);

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
        setContent(draft.content);
        editor.commands.setContent(draft.content as any, { emitUpdate: false });
        const maxPosition = editor.state.doc.content.size;
        const from = Math.max(1, Math.min(draft.selection?.from ?? 1, maxPosition));
        const to = Math.max(from, Math.min(draft.selection?.to ?? from, maxPosition));
        editor.commands.setTextSelection({ from, to });
        setSelection({ from, to });
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

  // Persist each edited state locally. This runs independently of server
  // autosave so a new, untitled or offline draft is still recoverable.
  useEffect(() => {
    if (!draftReady || !dirty) return;

    // Throttle rather than debounce: a continuously typed paragraph is still
    // committed to IndexedDB every 250 ms instead of waiting for a pause.
    pendingDraftRef.current = {
      key: draftStorageKey,
      draft: {
        version: 1,
        noteId,
        topicId,
        title,
        subject,
        tagsInput,
        pinned,
        content,
        selection,
        focusTarget,
        savedAt: Date.now(),
        serverUpdatedAt: initialNote?.updatedAt ? new Date(initialNote.updatedAt).getTime() : null,
      },
    };
    if (recoveryTimerRef.current === null) {
      setRecoveryStatus("Saving recovery copy…");
      recoveryTimerRef.current = window.setTimeout(() => {
        recoveryTimerRef.current = null;
        const pending = pendingDraftRef.current;
        if (!pending) return;
        void saveLocalNoteDraft(pending.key, pending.draft)
          .then(() => setRecoveryStatus("Recovery copy saved on this device"))
          .catch(() => setRecoveryStatus("Local recovery could not be saved"));
      }, 250);
    }

    return () => {
      // Intentionally keep the throttle timer alive across rapid edits.
    };
  }, [draftReady, dirty, draftStorageKey, noteId, topicId, title, subject, tagsInput, pinned, content, selection, focusTarget, initialNote?.updatedAt]);

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
        clearTimeout(recoveryTimerRef.current);
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
        content,
        selection,
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
  }, [draftReady, dirty, recoveryStatus, draftStorageKey, noteId, topicId, title, subject, tagsInput, pinned, content, selection, focusTarget, initialNote?.updatedAt]);

  const save = useCallback(async (
    quiet = false,
    options: { navigateOnCreate?: boolean; refreshOnSave?: boolean } = {},
  ): Promise<string | null> => {
    if (!topicId) { setError("Create a topic before writing a note."); return null; }
    if (!title.trim()) { if (!quiet) setError("Give your note a title before saving."); return null; }
    if (savingRef.current) return noteId;
    savingRef.current = true; setBusy(true); if (!quiet) setError(""); setStatus("Saving…");
    try {
      const payload = { topicId, title, subject, content, tags: tagsInput.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean).slice(0, 30), pinned };
      const response = await fetch(noteId ? `/api/notes/${noteId}` : "/api/notes", {
        method: noteId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save note.");
      const savedId = noteId ?? data.note.id;
      const savedDraftKey = noteId ? `note:${noteId}` : "note:new";
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
      // The editor is made read-only while a save is in flight, so the server
      // response represents the complete visible draft. Cancel any trailing
      // local throttle write before removing the recovered copy.
      if (recoveryTimerRef.current !== null) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      pendingDraftRef.current = null;
      setDirty(false);
      setStatus("All changes saved");
      setRecoveryStatus("Saved securely to your archive");
      await removeLocalNoteDraft(savedDraftKey).catch(() => undefined);
      if (options.refreshOnSave !== false) router.refresh();
      return savedId;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not save note.";
      setError(message); setStatus("Save failed"); setDirty(false); return null;
    } finally { savingRef.current = false; setBusy(false); }
  }, [topicId, title, subject, content, tagsInput, pinned, noteId, router]);

  useEffect(() => {
    // Image upload performs its own immediate document PATCH. Do not run the
    // background autosave concurrently with that upload/save sequence.
    if (!noteId || !dirty || busy || imageUploading) return;
    const timer = setTimeout(() => { void save(true); }, 1100);
    return () => clearTimeout(timer);
  }, [noteId, dirty, title, subject, topicId, tagsInput, pinned, content, save, busy, imageUploading]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function uploadImages(files: File[]) {
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
        failures.push(`${file.name}: unsupported format`);
        continue;
      }
      if (file.size === 0) {
        failures.push(`${file.name}: file is empty`);
        continue;
      }
      if (file.size > 20 * 1024 * 1024) {
        failures.push(`${file.name}: larger than 20 MB`);
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      setError(failures.join("; ") || "Choose one or more supported images.");
      return;
    }

    setError(failures.length ? failures.join("; ") : "");
    setImageUploading(true);
    let id = noteId;
    const shouldNavigateToEdit = window.location.pathname === "/notes/new";
    let insertedCount = 0;
    let updatedContent: any = null;

    try {
      // Create a new note in place first. Do not navigate away while the
      // selected image files are uploading and being inserted.
      if (!id) id = await save(false, { navigateOnCreate: false, refreshOnSave: false });
      if (!id) return;

      for (let index = 0; index < validFiles.length; index += 1) {
        const file = validFiles[index];
        setStatus(`Uploading image ${index + 1} of ${validFiles.length}…`);

        try {
          const form = new FormData();
          form.append("file", file, file.name);
          const response = await fetch(`/api/notes/${id}/assets`, {
            method: "POST",
            body: form,
            credentials: "same-origin",
          });
          const data = await response.json().catch(() => null);

          if (!response.ok) {
            throw new Error(data?.error || `Upload failed (HTTP ${response.status}).`);
          }
          if (!data?.asset?.url || typeof data.asset.url !== "string") {
            throw new Error("The server did not return the uploaded image address.");
          }

          // Temporarily enable ProseMirror for the insertion, then keep it
          // read-only for the remainder of the batch to avoid content races.
          editor.setEditable(true);
          const inserted = editor.chain().focus().setImage({
            src: data.asset.url,
            alt: file.name,
          }).run();
          editor.setEditable(false);

          if (!inserted) {
            await fetch(data.asset.url, { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
            throw new Error("The image could not be inserted into the note.");
          }

          insertedCount += 1;
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : "upload failed"}`);
        }
      }

      if (insertedCount === 0) {
        setError(failures.join("; ") || "No images could be uploaded.");
        setStatus("Upload failed");
        return;
      }

      updatedContent = editor.getJSON();
      setContent(updatedContent);
      setDirty(true);
      setStatus(`Saving ${insertedCount} ${insertedCount === 1 ? "image" : "images"} to note…`);

      // Save the complete document once after all successful uploads.
      setBusy(true);
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim().replace(/^#/, ""))
        .filter(Boolean)
        .slice(0, 30);
      const saveResponse = await fetch(`/api/notes/${id}`, {
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
      const saveData = await saveResponse.json().catch(() => null);

      if (!saveResponse.ok) {
        // Commit a local encrypted recovery copy before reporting failure.
        await saveLocalNoteDraft(`note:${id}`, {
          version: 1,
          noteId: id,
          topicId,
          title,
          subject,
          tagsInput,
          pinned,
          content: updatedContent,
          selection,
          focusTarget,
          savedAt: Date.now(),
          serverUpdatedAt: initialNote?.updatedAt ? new Date(initialNote.updatedAt).getTime() : null,
        }).catch(() => undefined);
        throw new Error(saveData?.error || "Images uploaded, but the note could not be updated. Your recovery copy has been kept.");
      }

      setDirty(false);
      setStatus("All changes saved");
      setRecoveryStatus("Saved securely to your archive");
      await Promise.all([
        removeLocalNoteDraft("note:new").catch(() => undefined),
        removeLocalNoteDraft(`note:${id}`).catch(() => undefined),
      ]);

      if (shouldNavigateToEdit) {
        router.replace(`/notes/${id}/edit`);
        router.refresh();
      }

      if (failures.length > 0) {
        setError(`${insertedCount} image(s) added. Some files were skipped: ${failures.join("; ")}`);
      } else {
        setError("");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Image upload failed.");
      setStatus(insertedCount > 0 ? "Images added; save needs attention" : "Upload failed");
      if (insertedCount > 0) setDirty(true);
    } finally {
      setBusy(false);
      setImageUploading(false);
    }
  }

  async function removeSelectedImage() {
    if (!editor || !editor.isActive("image")) return;
    const src = String(editor.getAttributes("image").src ?? "");
    const match = src.match(/^\/api\/assets\/([a-f0-9-]+)$/i);
    if (match) {
      const response = await fetch(`/api/assets/${match[1]}`, { method: "DELETE" });
      if (!response.ok) { setError("Could not remove this image from storage."); return; }
    }
    editor.chain().focus().deleteSelection().run();
  }

  async function removeNote() {
    if (!noteId || !confirm("Move this note to Recently deleted? You can restore it later.")) return;
    const response = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    if (response.ok) {
      if (noteId) void removeLocalNoteDraft(`note:${noteId}`).catch(() => undefined);
      router.push("/notes");
      router.refresh();
    }
    else setError("Could not move this note to Trash.");
  }

  const words = (editor?.getText() ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (!topics.length) return <main className="page"><div className="empty-state"><h3>Create a topic first</h3><p>Every note belongs to a topic. Create a collection, then come back to write.</p><Link href="/topics" className="primary-btn">Go to topics</Link></div></main>;

  return <main className="page"><div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:25 }}><Link href={noteId ? `/notes/${noteId}` : "/notes"} className="breadcrumb"><ArrowLeft size={14}/> {noteId ? "Back to note" : "All notes"}</Link><div style={{ display:"flex", gap:8 }}><span style={{ fontSize:10, color:"var(--muted)", alignSelf:"center" }}>{status}</span><button className="primary-btn" onClick={() => void save(false)} disabled={busy || imageUploading}><Save size={14}/>{busy ? "Saving…" : "Save note"}</button></div></div>
    <div className="note-layout"><section className="editor-main"><div className="eyebrow">{noteId ? "Refine your thinking" : "A new inscription"}</div><input id="note-title" onFocus={() => setFocusTarget("title")} dir="auto" lang={detectTextLanguage(title)} className="editor-title" value={title} onChange={(e) => { setTitle(e.target.value); setDirty(true); setStatus("Unsaved changes"); }} placeholder="Untitled note" maxLength={180} disabled={busy} aria-label="Note title"/><input id="note-subject" onFocus={() => setFocusTarget("subject")} dir="auto" lang={detectTextLanguage(subject)} className="editor-subject" value={subject} onChange={(e) => { setSubject(e.target.value); setDirty(true); setStatus("Unsaved changes"); }} placeholder="Add a subject or a quiet subtitle…" maxLength={180} disabled={busy} aria-label="Note subject"/>
      <div className="editor-toolbar" role="toolbar" aria-label="Text formatting"><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("bold") ? "active" : ""}`} onClick={() => editor?.chain().focus().toggleBold().run()} title="Bold"><Bold/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("italic") ? "active" : ""}`} onClick={() => editor?.chain().focus().toggleItalic().run()} title="Italic"><Italic/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("strike") ? "active" : ""}`} onClick={() => editor?.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough/></button><span className="tool-divider"/><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("heading",{level:1})?"active":""}`} onClick={() => editor?.chain().focus().toggleHeading({level:1}).run()} title="Heading 1"><Heading1/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("heading",{level:2})?"active":""}`} onClick={() => editor?.chain().focus().toggleHeading({level:2}).run()} title="Heading 2"><Heading2/></button><span className="tool-divider"/><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("bulletList")?"active":""}`} onClick={() => editor?.chain().focus().toggleBulletList().run()} title="Bulleted list"><List/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("orderedList")?"active":""}`} onClick={() => editor?.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered/></button><button disabled={busy || imageUploading} className={`tool-btn ${editor?.isActive("blockquote")?"active":""}`} onClick={() => editor?.chain().focus().toggleBlockquote().run()} title="Quote"><Quote/></button><button disabled={busy || imageUploading} className="tool-btn" onClick={() => editor?.chain().focus().setHorizontalRule().run()} title="Divider"><Minus/></button><span className="tool-divider"/><input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden disabled={!editor || busy || imageUploading} onChange={(e) => { const files=Array.from(e.currentTarget.files ?? []); e.currentTarget.value=""; if(files.length)void uploadImages(files); }}/><button disabled={!editor || busy || imageUploading} className="tool-btn" onClick={() => imageRef.current?.click()} title={imageUploading ? "Uploading images…" : "Add images"}><ImagePlus/></button><button disabled={busy || imageUploading || !imageSelected} className="tool-btn" onClick={() => void removeSelectedImage()} title="Remove selected image"><Trash2/></button><span className="tool-divider"/><button disabled={busy || imageUploading} className="tool-btn" onClick={() => editor?.chain().focus().undo().run()} title="Undo"><Undo2/></button><button disabled={busy || imageUploading} className="tool-btn" onClick={() => editor?.chain().focus().redo().run()} title="Redo"><Redo2/></button></div>
      <EditorContent editor={editor} onFocusCapture={() => setFocusTarget("editor")}/><div className="editor-footer"><span>{words} words</span><span>{recoveryStatus}</span><span>Private encrypted note</span></div>
    </section><aside className="editor-side"><section className="panel"><h3 className="panel-title">Note properties</h3><div className="property-block"><div className="property-label">Belongs to</div><select dir="auto" lang={detectTextLanguage(topics.find((topic) => topic.id === topicId)?.title ?? "")} className="select-field" value={topicId} disabled={busy} onChange={(e)=>{setTopicId(e.target.value);setDirty(true);setStatus("Unsaved changes");}}>{topics.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></div><div className="property-block"><div className="property-label">Tags</div><input id="note-tags" onFocus={() => setFocusTarget("tags")} dir="auto" lang={detectTextLanguage(tagsInput)} className="field" value={tagsInput} disabled={busy} onChange={(e)=>{setTagsInput(e.target.value);setDirty(true);setStatus("Unsaved changes");}} placeholder="philosophy, research…"/><p className="form-hint">Separate tags with commas.</p></div><button className={`secondary-btn`} disabled={busy} style={{ width:"100%", justifyContent:"flex-start" }} onClick={()=>{setPinned(!pinned);setDirty(true);setStatus("Unsaved changes");}}><Pin size={14}/>{pinned?"Remove from pinned":"Pin this note"}</button>{noteId&&<div style={{marginTop:10}}><NoteTopicTransfer noteId={noteId} currentTopicId={topicId} topics={topics} beforeTransfer={async()=>{if(busy)return false;return dirty?Boolean(await save(false)):true;}}/></div>}</section><section className="panel"><div className="property-label">Writing guidance</div><p className="form-hint" style={{fontSize:10,lineHeight:1.8}}>Use headings to create structure. Add quotations for source passages. Place images inline where they add context to the note.</p></section>{noteId&&<button className="danger-btn" onClick={removeNote} disabled={busy}><Trash2 size={14}/> Move to Trash</button>}</aside></div>{error&&<p className="error-text">{error}</p>}</main>;
}
