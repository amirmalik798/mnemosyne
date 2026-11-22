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
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("Personal");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);
  const [filterCategories, setFilterCategories] = useState(false);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>(["Personal", "Philosophy", "Science", "Technology", "Research", "Reading", "Work"]);
  const [categorySuggestionsError, setCategorySuggestionsError] = useState("");
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
    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      } else {
        document.querySelector<HTMLButtonElement>(".top-actions .primary-btn")?.focus();
      }
    };
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
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error || "Saved categories could not be loaded.");
        }
        if (!data || !Array.isArray(data.categories)) {
          throw new Error("The server returned an invalid category list.");
        }
        return data;
      })
      .then((data) => {
        const existing = data.categories
          .filter((category: unknown): category is string => typeof category === "string")
          .map((category: string) => category.trim())
          .filter(Boolean);
        setCategorySuggestions((current) =>
          Array.from(new Map<string, string>([...current, ...existing].map((value): [string, string] => [value.toLocaleLowerCase(), value])).values())
            .sort((a, b) => a.localeCompare(b)),
        );
        setCategorySuggestionsError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setCategorySuggestionsError(
            cause instanceof Error
              ? cause.message + " You can still use the built-in suggestions or type a category."
              : "Saved categories could not be loaded. You can still type a category.",
          );
        }
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
  const canCreateCategory = Boolean(category.trim()) && !hasExactCategory;
  const categoryOptionCount = visibleCategories.length + (canCreateCategory ? 1 : 0);

  function chooseCategory(value: string) {
    setCategory(value);
    setCategoryMenuOpen(false);
    setFilterCategories(false);
    setActiveCategoryIndex(0);
  }

  function chooseFile(next: File | null) {
    if (!next) return;
    const supportedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const supportedByName = /\.(png|jpe?g|webp|gif)$/i.test(next.name);
    if (!supportedTypes.includes(next.type) && !supportedByName) {
      return setError("Use a PNG, JPEG, WebP or GIF image for the topic cover. Your previous valid selection, if any, has been kept.");
    }
    if (next.size > 8 * 1024 * 1024) {
      return setError("The cover image must be 8 MB or smaller. Your previous valid selection, if any, has been kept.");
    }
    setError("");
    setFile(next);
    const nextPreview = URL.createObjectURL(next);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nextPreview;
    setPreview(nextPreview);
  }

  function removeSelectedFile() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPreview("");
    setFile(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 bytes";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!title.trim()) {
      setError("Give your topic a title.");
      titleInputRef.current?.focus();
      return;
    }

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
          throw new Error(coverData?.error || "The topic was created, but its cover could not be uploaded. Edit the topic to try again.");
        }
      }

      notifyOperation("success", file ? "Topic and cover image created successfully." : "Topic created successfully.");
      router.refresh();
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Something went wrong while creating the topic.";
      if (createdTopicId) {
        notifyOperation("failure", "The topic was created, but its cover could not be uploaded: " + message + " Add the cover from Topic settings.");
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
  const submitActionLabel = busy
    ? uploadProgress !== null ? "Uploading cover…" : "Creating…"
    : "Create topic";

  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}><section ref={modalRef} className="modal topic-create-modal" role="dialog" aria-modal="true" aria-labelledby="topic-modal-title" aria-describedby="topic-modal-description" aria-busy={busy}>
    <div className="modal-head"><div><div className="eyebrow">Add to your archive</div><h2 className="modal-title" id="topic-modal-title">Create a topic</h2><p className="modal-subtitle" id="topic-modal-description">Start with a title. Add a subject, category, description or cover now or later.</p></div><button type="button" className="icon-button icon-only-btn" onClick={requestClose} aria-label="Close dialog" title="Close dialog" disabled={busy}><X /></button></div>
    <form onSubmit={submit}>
      <p className="topic-dialog-guidance">Only the topic title is required. You can change the other details later.</p>
      <div className="form-grid" aria-busy={busy}>
      <div className="form-field full">
        <div className="topic-field-label-row"><label className="form-label" htmlFor="new-topic-title">Topic title</label><span className="topic-field-required">Required</span></div>
        <input ref={titleInputRef} id="new-topic-title" dir="auto" lang={detectTextLanguage(title)} className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Architecture of Thought" maxLength={120} required aria-required="true" aria-describedby="new-topic-title-help" autoFocus disabled={busy} />
        <div className="topic-field-meta"><span id="new-topic-title-help">A clear name makes this collection easy to recognize.</span><span className="topic-field-counter">{title.length} / 120</span></div>
      </div>
      <div className="form-field">
        <div className="topic-field-label-row"><label className="form-label" htmlFor="new-topic-subject">Subject</label><span className="topic-field-optional">Optional</span></div>
        <input id="new-topic-subject" dir="auto" lang={detectTextLanguage(subject)} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A short subtitle" maxLength={120} aria-describedby="new-topic-subject-help" disabled={busy} />
        <span className="topic-field-help" id="new-topic-subject-help">A short phrase to add context to the title.</span>
      </div>
      <div className="form-field"><div className="topic-field-label-row"><label className="form-label" htmlFor="new-topic-category">Category</label><span className="topic-field-optional">Optional</span></div><div className="category-combobox" ref={categoryRef}><div className="category-combobox-input-wrap"><input id="new-topic-category" disabled={busy} className="field category-combobox-input" role="combobox" aria-haspopup="listbox" aria-describedby="new-topic-category-help" aria-autocomplete="list" aria-expanded={categoryMenuOpen} aria-controls="new-topic-category-options" aria-activedescendant={categoryMenuOpen && categoryOptionCount > 0 ? `new-topic-category-option-${activeCategoryIndex}` : undefined} autoComplete="off" value={category} onFocus={() => { setCategoryMenuOpen(true); setFilterCategories(false); setActiveCategoryIndex(0); }} onClick={() => { setCategoryMenuOpen(true); setFilterCategories(false); setActiveCategoryIndex(0); }} onChange={(e) => { setCategory(e.target.value); setCategoryMenuOpen(true); setFilterCategories(true); setActiveCategoryIndex(0); }} onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setCategoryMenuOpen(false);
                setFilterCategories(false);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                if (!categoryMenuOpen) {
                  setCategoryMenuOpen(true);
                  setFilterCategories(true);
                  setActiveCategoryIndex(0);
                } else if (categoryOptionCount > 0) {
                  setActiveCategoryIndex((index) => (index + 1) % categoryOptionCount);
                }
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (!categoryMenuOpen) {
                  setCategoryMenuOpen(true);
                  setFilterCategories(true);
                  setActiveCategoryIndex(Math.max(0, categoryOptionCount - 1));
                } else if (categoryOptionCount > 0) {
                  setActiveCategoryIndex((index) => (index - 1 + categoryOptionCount) % categoryOptionCount);
                }
              } else if (e.key === "Enter" && categoryMenuOpen) {
                e.preventDefault();
                if (activeCategoryIndex < visibleCategories.length) {
                  chooseCategory(visibleCategories[activeCategoryIndex]);
                } else if (canCreateCategory) {
                  chooseCategory(category.trim());
                }
              }
            }} placeholder="Choose or create a category" maxLength={60}/><button type="button" disabled={busy} className="category-combobox-toggle" aria-label={categoryMenuOpen ? "Close categories" : "Open categories"} title={categoryMenuOpen ? "Close categories" : "Open categories"} aria-expanded={categoryMenuOpen} onClick={() => { setCategoryMenuOpen((open) => !open); setFilterCategories(false); setActiveCategoryIndex(0); }}><ChevronDown size={17}/></button></div>{categoryMenuOpen && <div className="category-combobox-menu" id="new-topic-category-options" role="listbox" aria-label="Available categories">{visibleCategories.map((item, index) => <button type="button" role="option" id={`new-topic-category-option-${index}`} aria-selected={category.toLocaleLowerCase() === item.toLocaleLowerCase()} className={`category-combobox-option ${activeCategoryIndex === index ? "active" : ""}`} key={item} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveCategoryIndex(index)} onClick={() => chooseCategory(item)}><span>{item}</span>{category.toLocaleLowerCase() === item.toLocaleLowerCase() && <Check size={15}/>}</button>)}{canCreateCategory && <button type="button" role="option" id={`new-topic-category-option-${visibleCategories.length}`} aria-selected="false" className={`category-combobox-option category-combobox-create ${activeCategoryIndex === visibleCategories.length ? "active" : ""}`} aria-label={`Create category ${category.trim()}`} title={`Create category ${category.trim()}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveCategoryIndex(visibleCategories.length)} onClick={() => chooseCategory(category.trim())}><Plus size={15} aria-hidden="true"/><span>Create category</span></button>}{visibleCategories.length === 0 && hasExactCategory === false && !category.trim() && <div className="category-combobox-empty">No categories yet. Type a name to create one.</div>}</div>}</div><span className="topic-field-help" id="new-topic-category-help">Personal is selected by default. Type to filter or create a category; use ↑ / ↓ and Enter to choose a suggestion.</span>{categorySuggestionsError && <OperationStatus kind="failure" message={categorySuggestionsError} compact />}</div>
      <div className="form-field full">
        <div className="topic-field-label-row"><label className="form-label" htmlFor="new-topic-description">Description</label><span className="topic-field-optional">Optional</span></div>
        <textarea id="new-topic-description" dir="auto" lang={detectTextLanguage(description)} className="textarea-field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What belongs in this collection?" maxLength={1000} aria-describedby="new-topic-description-help" disabled={busy} />
        <div className="topic-field-meta"><span id="new-topic-description-help">A sentence about what you plan to collect here.</span><span className="topic-field-counter">{description.length} / 1,000</span></div>
      </div>
      <div className="form-field full topic-cover-field">
        <div className="topic-field-label-row"><label className="form-label" htmlFor="new-topic-cover">Custom thumbnail</label><span className="topic-field-optional">Optional</span></div>
        <input id="new-topic-cover" ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { chooseFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
        <button type="button" className="cover-upload" onClick={() => fileRef.current?.click()} disabled={busy} aria-describedby="new-topic-cover-help" aria-label={preview ? "Replace topic cover image" : "Choose topic cover image"} title={preview ? "Replace topic cover image" : "Choose topic cover image"}>{preview ? <><img src={preview} alt={`Selected cover preview: ${file?.name || "Topic cover"}`} /><ImagePlus size={19} aria-hidden="true" /></> : <ImagePlus size={22} aria-hidden="true" />}<span>{preview ? "Replace cover image" : "Choose cover image"}</span></button>
        <span className="topic-field-help" id="new-topic-cover-help">PNG, JPEG, WebP or GIF. Maximum file size: 8 MB.</span>
        {file && (
          <div className="topic-cover-selection" aria-live="polite">
            <span className="topic-cover-selection-icon"><Check size={15} aria-hidden="true" /></span>
            <span className="topic-cover-selection-info">
              <strong dir="auto">{file.name}</strong>
              <small>{formatFileSize(file.size)} · Ready to upload when you create the topic</small>
            </span>
            <button type="button" className="topic-cover-remove secondary-btn" onClick={removeSelectedFile} disabled={busy}>
              <X size={14} aria-hidden="true" /><span>Remove file</span>
            </button>
          </div>
        )}
      </div>
    </div>
    {busy && <OperationStatus kind="processing" message={processingMessage} />}
    {uploadProgress !== null && <UploadProgress label="Uploading topic cover" percentage={uploadProgress} detail={file?.name} />}
    {error && <OperationStatus kind="failure" message={error} />}
    <div className="form-actions">
      <button type="button" className="secondary-btn topic-dialog-action" onClick={requestClose} disabled={busy}><X size={16} aria-hidden="true" /><span>Cancel</span></button>
      <button type="submit" className="primary-btn topic-dialog-action" disabled={busy} aria-label={submitActionLabel} aria-busy={busy}>
        {busy ? <LoaderCircle className="operation-spinner" size={17} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
        <span>{submitActionLabel}</span>
      </button>
    </div>
    </form>
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
