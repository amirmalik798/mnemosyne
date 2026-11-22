"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ImagePlus, LoaderCircle, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus, notifyOperation } from "@/components/operation-status";
import { UploadProgress } from "@/components/upload-progress";
import { uploadFormDataWithProgress } from "@/lib/upload-form-data";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

export function TopicDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLElement>(null);
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
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const hasUnsavedChanges =
    title !== "" ||
    subject !== "" ||
    category !== "Personal" ||
    description !== "" ||
    file !== null;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => previouslyFocused?.focus();
  }, []);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }, []);

  useEffect(() => {
    if (confirmDiscard) return;

    const container = modalRef.current;
    if (!container) return;

    function handleTab(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusable = container?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable?.length || !container) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleTab, true);
    return () => document.removeEventListener("keydown", handleTab, true);
  }, [confirmDiscard]);

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
        setUploadProgress(0);
        const coverResponse = await uploadFormDataWithProgress<{ error?: string }>(`/api/topics/${data.topic.id}/cover`, form, (progress) => setUploadProgress(progress.percentage));
        const coverData = coverResponse.data;
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
      setUploadProgress(null);
    }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}><section ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="topic-modal-title" aria-describedby="topic-modal-description">
    <div className="modal-head"><div><div className="eyebrow">Add to your archive</div><h2 className="modal-title" id="topic-modal-title">Create a topic</h2><p className="modal-subtitle" id="topic-modal-description">Give a subject a considered home.</p></div><button type="button" className="icon-button icon-only-btn" onClick={requestClose} aria-label="Close dialog" title="Close dialog" disabled={busy}><X /></button></div>
    <form onSubmit={submit}><div className="form-grid" aria-busy={busy}>
      <div className="form-field full"><label className="form-label" htmlFor="new-topic-title">Topic title *</label><input id="new-topic-title" dir="auto" lang={detectTextLanguage(title)} className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Architecture of Thought" maxLength={120} required autoFocus disabled={busy} /></div>
      <div className="form-field"><label className="form-label" htmlFor="new-topic-subject">Subject</label><input id="new-topic-subject" dir="auto" lang={detectTextLanguage(subject)} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A short subtitle" maxLength={120} disabled={busy} /></div>
      <div className="form-field"><label className="form-label" htmlFor="new-topic-category">Category</label><div className="category-combobox" ref={categoryRef}><div className="category-combobox-input-wrap"><input id="new-topic-category" disabled={busy} className="field category-combobox-input" role="combobox" aria-autocomplete="list" aria-expanded={categoryMenuOpen} aria-controls="new-topic-category-options" autoComplete="off" value={category} onFocus={() => { setCategoryMenuOpen(true); setFilterCategories(false); }} onClick={() => { setCategoryMenuOpen(true); setFilterCategories(false); }} onChange={(e) => { setCategory(e.target.value); setCategoryMenuOpen(true); setFilterCategories(true); }} onKeyDown={(e) => { if (e.key === "Escape") { setCategoryMenuOpen(false); setFilterCategories(false); } else if (e.key === "ArrowDown") { e.preventDefault(); setCategoryMenuOpen(true); setFilterCategories(true); } else if (e.key === "Enter" && categoryMenuOpen) { e.preventDefault(); if (visibleCategories.length) chooseCategory(visibleCategories[0]); else { setCategoryMenuOpen(false); setFilterCategories(false); } } }} placeholder="Choose or create a category" maxLength={60}/><button type="button" disabled={busy} className="category-combobox-toggle" aria-label={categoryMenuOpen ? "Close categories" : "Open categories"} title={categoryMenuOpen ? "Close categories" : "Open categories"} aria-expanded={categoryMenuOpen} onClick={() => { setCategoryMenuOpen((open) => !open); setFilterCategories(false); }}><ChevronDown size={17}/></button></div>{categoryMenuOpen && <div className="category-combobox-menu" id="new-topic-category-options" role="listbox" aria-label="Available categories">{visibleCategories.map((item) => <button type="button" role="option" aria-selected={category.toLocaleLowerCase() === item.toLocaleLowerCase()} className="category-combobox-option" key={item} onMouseDown={(e) => e.preventDefault()} onClick={() => chooseCategory(item)}><span>{item}</span>{category.toLocaleLowerCase() === item.toLocaleLowerCase() && <Check size={15}/>}</button>)}{category.trim() && !hasExactCategory && <button type="button" role="option" aria-selected="false" className="category-combobox-option category-combobox-create icon-only-btn" aria-label={`Create category ${category.trim()}`} title={`Create category ${category.trim()}`} onMouseDown={(e) => e.preventDefault()} onClick={() => chooseCategory(category.trim())}><Plus size={17}/></button>}{visibleCategories.length === 0 && hasExactCategory === false && !category.trim() && <div className="category-combobox-empty">No categories yet. Type a name to create one.</div>}</div>}</div><span className="form-hint">Choose an existing category or type a new one. New categories become available after you create this topic.</span></div>
      <div className="form-field full"><label className="form-label" htmlFor="new-topic-description">Description</label><textarea id="new-topic-description" dir="auto" lang={detectTextLanguage(description)} className="textarea-field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What belongs in this collection?" maxLength={1000} disabled={busy} /></div>
      <div className="form-field full"><label className="form-label" htmlFor="new-topic-cover">Custom thumbnail</label><input id="new-topic-cover" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { chooseFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} /><button type="button" className="cover-upload" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={preview ? "Replace topic cover image" : "Choose topic cover image"} title={preview ? "Replace topic cover image" : "Choose topic cover image"}>{preview ? <><img src={preview} alt="Current topic cover preview" /><ImagePlus size={19} aria-hidden="true" /></> : <ImagePlus size={22} aria-hidden="true" />}<span>{preview ? "Replace cover image" : "Choose cover image"}</span></button></div>
    </div>{busy && <OperationStatus kind="processing" message={processingMessage} />} {uploadProgress !== null && <UploadProgress label="Uploading topic cover" percentage={uploadProgress} detail={file?.name} />} {error && <OperationStatus kind="failure" message={error} />}<div className="form-actions"><button type="button" className="secondary-btn icon-only-btn" onClick={requestClose} disabled={busy} aria-label="Cancel" title="Cancel"><X size={17} /></button><button type="submit" className="primary-btn icon-only-btn" disabled={busy} aria-label={busy ? processingMessage : "Create topic"} title={busy ? processingMessage : "Create topic"}>{busy ? <LoaderCircle className="operation-spinner" size={17} /> : <Plus size={18} />}</button></div></form>
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
