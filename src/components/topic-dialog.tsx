"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ImagePlus, LoaderCircle, Plus, X, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus, notifyOperation } from "@/components/operation-status";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

export function TopicDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("Personal");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [filterCategories, setFilterCategories] = useState(false);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>(["Personal", "Philosophy", "Science", "Technology", "Research", "Reading", "Work"]);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const previewUrlRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("Creating topic…");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const hasUnsavedChanges =
    title !== "" ||
    subject !== "" ||
    category !== "Personal" ||
    description !== "" ||
    file !== null;

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }, []);

  function requestClose() {
    if (busy) return;
    if (hasUnsavedChanges) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/topics/categories", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.categories)) return;
        const existing = data.categories
          .filter((category: unknown): category is string => typeof category === "string")
          .map((category: string) => category.trim())
          .filter(Boolean);
        setCategorySuggestions((current) =>
          Array.from(new Map<string, string>([...current, ...existing].map((value): [string, string] => [value.toLocaleLowerCase(), value])).values())
            .sort((a, b) => a.localeCompare(b)),
        );
      })
      .catch(() => {
        // Built-in suggestions and free-text categories remain available offline.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && !categoryRef.current?.contains(event.target)) {
        setCategoryMenuOpen(false);
        setFilterCategories(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;

      // Let the category combobox consume Escape before the dialog does.
      if (categoryMenuOpen) return;

      event.preventDefault();
      event.stopPropagation();

      // Escape first dismisses the confirmation prompt. A second Escape
      // returns to the normal close flow without discarding automatically.
      if (confirmDiscard) {
        setConfirmDiscard(false);
        return;
      }

      if (busy) return;
      if (hasUnsavedChanges) {
        setConfirmDiscard(true);
      } else {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [categoryMenuOpen, confirmDiscard, busy, hasUnsavedChanges, onClose]);

  const visibleCategories = categorySuggestions.filter((item) => {
    if (!filterCategories || !category.trim()) return true;
    return item.toLocaleLowerCase().includes(category.trim().toLocaleLowerCase());
  });
  const hasExactCategory = categorySuggestions.some(
    (item) => item.toLocaleLowerCase() === category.trim().toLocaleLowerCase(),
  );

  function chooseCategory(value: string) {
    setCategory(value);
    setCategoryMenuOpen(false);
    setFilterCategories(false);
  }

  function chooseFile(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("image/")) return setError("Choose an image file for the topic cover.");
    if (next.size > 8 * 1024 * 1024) return setError("The cover image must be 8 MB or smaller.");
    setError("");
    setFile(next);
    const nextPreview = URL.createObjectURL(next);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nextPreview;
    setPreview(nextPreview);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!title.trim()) return setError("Give your topic a title.");

    let createdTopicId: string | null = null;
    setProcessingMessage("Creating topic…");
    setBusy(true);
    try {
      const response = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, subject, category: category.trim(), description }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create topic.");
      createdTopicId = typeof data.topic?.id === "string" ? data.topic.id : null;

      if (file) {
        setProcessingMessage("Uploading the topic cover image…");
        const form = new FormData();
        form.append("file", file);
        const coverResponse = await fetch(`/api/topics/${data.topic.id}/cover`, { method: "POST", body: form });
        const coverData = await coverResponse.json();
        if (!coverResponse.ok) {
          throw new Error(coverData.error || "The topic was created, but its cover could not be uploaded. Edit the topic to try again.");
        }
      }

      notifyOperation("success", file ? "Topic and cover image created successfully." : "Topic created successfully.");
      router.refresh();
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Something went wrong while creating the topic.";
      if (createdTopicId) {
        notifyOperation("failure", "The topic was created, but its cover could not be uploaded. Add the cover from Topic settings.");
        router.push(`/topics/${createdTopicId}/edit`);
        router.refresh();
        onClose();
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="topic-modal-title">
    <div className="modal-head"><div><div className="eyebrow">Add to your archive</div><h2 className="modal-title" id="topic-modal-title">Create a topic</h2><p className="modal-subtitle">Give a subject a considered home.</p></div><button className="icon-button" onClick={requestClose} aria-label="Close" disabled={busy}><X /></button></div>
    <form onSubmit={submit}><div className="form-grid">
      <div className="form-field full"><label className="form-label">Topic title *</label><input dir="auto" lang={detectTextLanguage(title)} className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Architecture of Thought" maxLength={120} required autoFocus /></div>
      <div className="form-field"><label className="form-label">Subject</label><input dir="auto" lang={detectTextLanguage(subject)} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A short subtitle" maxLength={120} /></div>
      <div className="form-field"><label className="form-label" htmlFor="new-topic-category">Category</label><div className="category-combobox" ref={categoryRef}><div className="category-combobox-input-wrap"><input id="new-topic-category" className="field category-combobox-input" role="combobox" aria-autocomplete="list" aria-expanded={categoryMenuOpen} aria-controls="new-topic-category-options" autoComplete="off" value={category} onFocus={() => { setCategoryMenuOpen(true); setFilterCategories(false); }} onClick={() => { setCategoryMenuOpen(true); setFilterCategories(false); }} onChange={(e) => { setCategory(e.target.value); setCategoryMenuOpen(true); setFilterCategories(true); }} onKeyDown={(e) => { if (e.key === "Escape") { setCategoryMenuOpen(false); setFilterCategories(false); } else if (e.key === "ArrowDown") { e.preventDefault(); setCategoryMenuOpen(true); setFilterCategories(true); } else if (e.key === "Enter" && categoryMenuOpen) { e.preventDefault(); if (visibleCategories.length) chooseCategory(visibleCategories[0]); else { setCategoryMenuOpen(false); setFilterCategories(false); } } }} placeholder="Choose or create a category" maxLength={60}/><button type="button" className="category-combobox-toggle" aria-label={categoryMenuOpen ? "Close categories" : "Open categories"} aria-expanded={categoryMenuOpen} onClick={() => { setCategoryMenuOpen((open) => !open); setFilterCategories(false); }}><ChevronDown size={17}/></button></div>{categoryMenuOpen && <div className="category-combobox-menu" id="new-topic-category-options" role="listbox" aria-label="Available categories">{visibleCategories.map((item) => <button type="button" role="option" aria-selected={category.toLocaleLowerCase() === item.toLocaleLowerCase()} className="category-combobox-option" key={item} onMouseDown={(e) => e.preventDefault()} onClick={() => chooseCategory(item)}><span>{item}</span>{category.toLocaleLowerCase() === item.toLocaleLowerCase() && <Check size={15}/>}</button>)}{category.trim() && !hasExactCategory && <button type="button" role="option" aria-selected="false" className="category-combobox-option category-combobox-create" onMouseDown={(e) => e.preventDefault()} onClick={() => chooseCategory(category.trim())}><Plus size={15}/><span>Create “{category.trim()}”</span></button>}{visibleCategories.length === 0 && hasExactCategory === false && !category.trim() && <div className="category-combobox-empty">No categories yet. Type a name to create one.</div>}</div>}</div><span className="form-hint">Choose an existing category or type a new one. New categories become available after you create this topic.</span></div>
      <div className="form-field full"><label className="form-label">Description</label><textarea dir="auto" lang={detectTextLanguage(description)} className="textarea-field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What belongs in this collection?" maxLength={1000} /></div>
      <div className="form-field full"><label className="form-label">Custom thumbnail</label><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} /><button type="button" className="cover-upload" onClick={() => fileRef.current?.click()}>{preview ? <><img src={preview} alt="Cover preview" /><span className="cover-upload-text"><strong style={{ color: "var(--text)" }}>{file?.name}</strong><br />Click to replace cover · 8 MB maximum</span></> : <><span className="brand-mark"><ImagePlus /></span><span className="cover-upload-text"><strong style={{ color: "var(--text)" }}>Choose a cover image</strong><br />PNG, JPEG, WebP or GIF · up to 8 MB</span><UploadCloud size={18} /></>}</button></div>
    </div>{busy && <OperationStatus kind="processing" message={processingMessage} />} {error && <OperationStatus kind="failure" message={error} />}<div className="form-actions"><button type="button" className="secondary-btn" onClick={requestClose} disabled={busy}>Cancel</button><button type="submit" className="primary-btn" disabled={busy}>{busy ? <><LoaderCircle className="operation-spinner" size={14} /> {processingMessage.includes("Uploading") ? "Uploading cover…" : "Creating…"}</> : "Create topic"}</button></div></form>
  </section>
    {confirmDiscard && <ConfirmationDialog
      options={{
        eyebrow: "Unsaved changes",
        title: "Discard this topic?",
        description: "Your topic details and selected cover image have not been saved. Close this dialog and discard your changes?",
        cancelLabel: "Keep editing",
        confirmLabel: "Discard changes",
        tone: "danger",
      }}
      onCancel={() => setConfirmDiscard(false)}
      onConfirm={() => {
        setConfirmDiscard(false);
        onClose();
      }}
    />}
  </div>; 
}
