"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ImagePlus, LoaderCircle, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus, notifyOperation } from "@/components/operation-status";
import { UploadProgress } from "@/components/upload-progress";
import { uploadFormDataWithProgress } from "@/lib/upload-form-data";
import { ConfirmationDialog } from "@/components/confirmation-dialog";

export type TopicDialogTopic = {
  id: string;
  title: string;
  subject: string;
  description: string;
  category: string;
  coverUrl: string | null;
  noteCount: number;
};

type TopicDialogProps = {
  onClose: () => void;
  mode?: "create" | "edit";
  topic?: TopicDialogTopic;
};

export function TopicDialog({ onClose, mode = "create", topic }: TopicDialogProps) {
  const router = useRouter();
  const isEdit = mode === "edit";
  if (isEdit && !topic) throw new Error("TopicDialog requires topic data in edit mode.");
  const initialCategory = topic?.category || "Personal";
  const fileRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(topic?.title ?? "");
  const [subject, setSubject] = useState(topic?.subject ?? "");
  const [category, setCategory] = useState(initialCategory);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);
  const [filterCategories, setFilterCategories] = useState(false);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>(["Personal", "Philosophy", "Science", "Technology", "Research", "Reading", "Work"]);
  const [categorySuggestionsError, setCategorySuggestionsError] = useState("");
  const [description, setDescription] = useState(topic?.description ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [savedCoverUrl, setSavedCoverUrl] = useState(topic?.coverUrl ?? "");
  const [preview, setPreview] = useState(topic?.coverUrl ?? "");
  const previewUrlRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("Creating topic…");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<"discard" | "delete" | "remove-cover" | null>(null);
  const hasUnsavedChanges = isEdit
    ? Boolean(topic && (
        title !== topic.title ||
        subject !== topic.subject ||
        category !== initialCategory ||
        description !== topic.description ||
        file !== null
      ))
    : title.trim() !== "" || subject !== "" || category !== "Personal" || description !== "" || file !== null;

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
    if (confirmation) return;

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
  }, [confirmation]);

  function requestClose() {
    if (busy) return;
    if (hasUnsavedChanges) {
      setConfirmation("discard");
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
          Array.from(new Map<string, string>([...current, ...existing, ...(topic?.category ? [topic.category] : [])].map((value): [string, string] => [value.toLocaleLowerCase(), value])).values())
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
  }, [topic?.category]);

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
      if (confirmation) {
        setConfirmation(null);
        return;
      }

      if (busy) return;
      if (hasUnsavedChanges) {
        setConfirmation("discard");
      } else {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [categoryMenuOpen, confirmation, busy, hasUnsavedChanges, onClose]);

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
    setPreview(savedCoverUrl);
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
    if (busy) return;
    setError("");
    if (!title.trim()) {
      setError("Give your topic a title.");
      titleInputRef.current?.focus();
      return;
    }

    let topicId: string | null = null;
    let succeeded = false;
    setProcessingMessage(isEdit ? "Saving topic details…" : "Creating topic…");
    setBusy(true);
    try {
      const response = isEdit && topic
        ? await fetch(`/api/topics/${topic.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, subject, category: category.trim(), description }),
          })
        : await fetch("/api/topics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, subject, category: category.trim(), description }),
          });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || (isEdit ? "Could not save topic details." : "Could not create topic."));
      }

      topicId = isEdit && topic
        ? topic.id
        : typeof data.topic?.id === "string" ? data.topic.id : null;
      if (!topicId) throw new Error("The server did not return the new topic identifier.");

      if (file) {
        setProcessingMessage(isEdit ? "Uploading the new topic cover…" : "Uploading the topic cover image…");
        const form = new FormData();
        form.append("file", file);
        setUploadProgress(0);
        const coverResponse = await uploadFormDataWithProgress<{ error?: string; coverUrl?: string }>(
          `/api/topics/${topicId}/cover`,
          form,
          (progress) => setUploadProgress(progress.percentage),
        );
        const coverData = coverResponse.data;
        if (!coverResponse.ok) {
          throw new Error(coverData?.error || (isEdit
            ? "Topic details were saved, but the cover image could not be uploaded."
            : "The topic was created, but its cover could not be uploaded. Edit the topic to try again."));
        }
        if (isEdit && typeof coverData?.coverUrl === "string") {
          setSavedCoverUrl(coverData.coverUrl);
        }
      }

      notifyOperation(
        "success",
        isEdit
          ? file ? "Topic details and cover image saved." : "Topic details saved successfully."
          : file ? "Topic and cover image created successfully." : "Topic created successfully.",
      );
      succeeded = true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Something went wrong while saving the topic.";
      if (!isEdit && topicId) {
        notifyOperation("failure", "The topic was created, but its cover could not be uploaded: " + message + " Add the cover from Topic settings.");
        router.push(`/topics/${topicId}/edit`);
        router.refresh();
        onClose();
      } else {
        setError(message);
        notifyOperation("failure", message);
      }
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }

    if (succeeded) {
      router.refresh();
      onClose();
    }
  }
  async function deleteTopic() {
    if (!isEdit || !topic || busy || topic.noteCount > 0) return;
    setBusy(true);
    setError("");
    setProcessingMessage("Deleting topic…");
    try {
      const response = await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete topic.");
      setConfirmation(null);
      notifyOperation("success", "Topic deleted successfully.");
      onClose();
      router.push("/topics");
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not delete topic.";
      setError(message);
      notifyOperation("failure", message);
    } finally {
      setBusy(false);
      setProcessingMessage("");
    }
  }

  async function removeExistingCover() {
    if (!isEdit || !topic || !savedCoverUrl || file || busy) return;
    setBusy(true);
    setError("");
    setProcessingMessage("Removing topic cover…");
    try {
      const response = await fetch(`/api/topics/${topic.id}/cover`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove topic cover.");
      setSavedCoverUrl("");
      setPreview("");
      notifyOperation("success", "Topic cover removed.");
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not remove cover.";
      setError(message);
      notifyOperation("failure", message);
    } finally {
      setBusy(false);
      setProcessingMessage("");
    }
  }

  const submitActionLabel = busy
    ? uploadProgress !== null ? "Uploading cover…" : isEdit ? "Saving…" : "Creating…"
    : isEdit ? "Save changes" : "Create topic";

  const fieldPrefix = isEdit ? "edit-topic" : "new-topic";
  const dialogTitle = isEdit ? "Edit topic" : "Create a topic";
  const dialogEyebrow = isEdit ? "Collection settings" : "Add to your archive";
  const dialogSubtitle = isEdit
    ? "Update this collection while keeping its notes and references in view."
    : "Start with a title. Add a subject, category, description or cover now or later.";
  const dialogGuidance = isEdit
    ? "Change the details you want to update. Your existing notes will stay in this collection."
    : "Only the topic title is required. You can change the other details later.";

  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}><section ref={modalRef} className="modal topic-create-modal" role="dialog" aria-modal="true" aria-labelledby="topic-modal-title" aria-describedby="topic-modal-description" aria-busy={busy}>
    <div className="modal-head"><div><div className="eyebrow">{dialogEyebrow}</div><h2 className="modal-title" id="topic-modal-title">{dialogTitle}</h2><p className="modal-subtitle" id="topic-modal-description">{dialogSubtitle}</p></div><button type="button" className="icon-button icon-only-btn" onClick={requestClose} aria-label="Close dialog" disabled={busy}><X /></button></div>
    <form onSubmit={submit}>
      <p className="topic-dialog-guidance">{dialogGuidance}</p>
      <div className="form-grid" aria-busy={busy}>
      <div className="form-field full">
        <div className="topic-field-label-row"><label className="form-label" htmlFor={`${fieldPrefix}-title`}>Topic title</label><span className="topic-field-required">Required</span></div>
        <input ref={titleInputRef} id={`${fieldPrefix}-title`} dir="auto" lang={detectTextLanguage(title)} className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Architecture of Thought" maxLength={120} required aria-required="true" aria-describedby="new-topic-title-help" autoFocus disabled={busy} />
        <div className="topic-field-meta"><span id={`${fieldPrefix}-title-help`}>A clear name makes this collection easy to recognize.</span><span className="topic-field-counter">{title.length} / 120</span></div>
      </div>
      <div className="form-field">
        <div className="topic-field-label-row"><label className="form-label" htmlFor={`${fieldPrefix}-subject`}>Subject</label><span className="topic-field-optional">Optional</span></div>
        <input id={`${fieldPrefix}-subject`} dir="auto" lang={detectTextLanguage(subject)} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A short subtitle" maxLength={120} aria-describedby="new-topic-subject-help" disabled={busy} />
        <span className="topic-field-help" id={`${fieldPrefix}-subject-help`}>A short phrase to add context to the title.</span>
      </div>
      <div className="form-field"><div className="topic-field-label-row"><label className="form-label" htmlFor={`${fieldPrefix}-category`}>Category</label><span className="topic-field-optional">Optional</span></div><div className="category-combobox" ref={categoryRef}><div className="category-combobox-input-wrap"><input id={`${fieldPrefix}-category`} disabled={busy} className="field category-combobox-input" role="combobox" aria-haspopup="listbox" aria-describedby={`${fieldPrefix}-category-help`} aria-autocomplete="list" aria-expanded={categoryMenuOpen} aria-controls={`${fieldPrefix}-category-options`} aria-activedescendant={categoryMenuOpen && categoryOptionCount > 0 ? `${fieldPrefix}-category-option-${activeCategoryIndex}` : undefined} autoComplete="off" value={category} onFocus={() => { setCategoryMenuOpen(true); setFilterCategories(false); setActiveCategoryIndex(0); }} onClick={() => { setCategoryMenuOpen(true); setFilterCategories(false); setActiveCategoryIndex(0); }} onChange={(e) => { setCategory(e.target.value); setCategoryMenuOpen(true); setFilterCategories(true); setActiveCategoryIndex(0); }} onKeyDown={(e) => {
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
            }} placeholder="Choose or create a category" maxLength={60}/><button type="button" disabled={busy} className="category-combobox-toggle" aria-label={categoryMenuOpen ? "Close categories" : "Open categories"} title={categoryMenuOpen ? "Close categories" : "Open categories"} aria-expanded={categoryMenuOpen} onClick={() => { setCategoryMenuOpen((open) => !open); setFilterCategories(false); setActiveCategoryIndex(0); }}><ChevronDown size={17}/></button></div>{categoryMenuOpen && <div className="category-combobox-menu" id={`${fieldPrefix}-category-options`} role="listbox" aria-label="Available categories">{visibleCategories.map((item, index) => <button type="button" role="option" id={`${fieldPrefix}-category-option-${index}`} aria-selected={category.toLocaleLowerCase() === item.toLocaleLowerCase()} className={`category-combobox-option ${activeCategoryIndex === index ? "active" : ""}`} key={item} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveCategoryIndex(index)} onClick={() => chooseCategory(item)}><span>{item}</span>{category.toLocaleLowerCase() === item.toLocaleLowerCase() && <Check size={15}/>}</button>)}{canCreateCategory && <button type="button" role="option" id={`${fieldPrefix}-category-option-${visibleCategories.length}`} aria-selected="false" className={`category-combobox-option category-combobox-create ${activeCategoryIndex === visibleCategories.length ? "active" : ""}`} aria-label={`Create category ${category.trim()}`} title={`Create category ${category.trim()}`} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActiveCategoryIndex(visibleCategories.length)} onClick={() => chooseCategory(category.trim())}><Plus size={15} aria-hidden="true"/><span>Create category</span></button>}{visibleCategories.length === 0 && hasExactCategory === false && !category.trim() && <div className="category-combobox-empty">No categories yet. Type a name to create one.</div>}</div>}</div><span className="topic-field-help" id={`${fieldPrefix}-category-help`}>Personal is selected by default. Type to filter or create a category; use ↑ / ↓ and Enter to choose a suggestion.</span>{categorySuggestionsError && <OperationStatus kind="failure" message={categorySuggestionsError} compact />}</div>
      <div className="form-field full">
        <div className="topic-field-label-row"><label className="form-label" htmlFor={`${fieldPrefix}-description`}>Description</label><span className="topic-field-optional">Optional</span></div>
        <textarea id={`${fieldPrefix}-description`} dir="auto" lang={detectTextLanguage(description)} className="textarea-field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What belongs in this collection?" maxLength={1000} aria-describedby="new-topic-description-help" disabled={busy} />
        <div className="topic-field-meta"><span id={`${fieldPrefix}-description-help`}>A sentence about what you plan to collect here.</span><span className="topic-field-counter">{description.length} / 1,000</span></div>
      </div>
      <div className="form-field full topic-cover-field">
        <div className="topic-field-label-row"><label className="form-label" htmlFor={`${fieldPrefix}-cover`}>Custom thumbnail</label><span className="topic-field-optional">Optional</span></div>
        <input id={`${fieldPrefix}-cover`} ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { chooseFile(e.target.files?.[0] ?? null); e.currentTarget.value = ""; }} />
        <button type="button" className="cover-upload" onClick={() => fileRef.current?.click()} disabled={busy} aria-describedby="new-topic-cover-help" aria-label={preview ? "Replace topic cover image" : "Choose topic cover image"} title={preview ? "Replace topic cover image" : "Choose topic cover image"}>{preview ? <><img src={preview} alt={file ? `Selected cover preview: ${file.name}` : "Current topic cover preview"} /><ImagePlus size={19} aria-hidden="true" /></> : <ImagePlus size={22} aria-hidden="true" />}<span>{preview ? "Replace cover image" : "Choose cover image"}</span></button>
        <span className="topic-field-help" id={`${fieldPrefix}-cover-help`}>PNG, JPEG, WebP or GIF. Maximum file size: 8 MB.</span>
        {file && (
          <div className="topic-cover-selection" aria-live="polite">
            <span className="topic-cover-selection-icon"><Check size={15} aria-hidden="true" /></span>
            <span className="topic-cover-selection-info">
              <strong dir="auto">{file.name}</strong>
              <small>{formatFileSize(file.size)} · Ready to upload when you {isEdit ? "save changes" : "create the topic"}</small>
            </span>
            <button type="button" className="topic-cover-remove secondary-btn" onClick={removeSelectedFile} disabled={busy}>
              <X size={14} aria-hidden="true" /><span>{isEdit ? "Undo replacement" : "Remove file"}</span>
            </button>
          </div>
        )}
        {isEdit && savedCoverUrl && !file && (
          <button type="button" className="secondary-btn topic-cover-remove-action" onClick={() => setConfirmation("remove-cover")} disabled={busy}>
            <Trash2 size={15} aria-hidden="true" /><span>Remove topic cover</span>
          </button>
        )}
      </div>
    </div>
    {busy && <OperationStatus kind="processing" message={processingMessage} />}
    {uploadProgress !== null && <UploadProgress label="Uploading topic cover" percentage={uploadProgress} detail={file?.name} />}
    {error && <OperationStatus kind="failure" message={error} />}
    <div className="form-actions topic-dialog-actions">
      {isEdit && (
        <button type="button" className="danger-btn topic-dialog-delete" onClick={() => setConfirmation("delete")} disabled={busy || (topic?.noteCount ?? 0) > 0} title={(topic?.noteCount ?? 0) > 0 ? "Move or delete this topic's notes before deleting it" : "Delete topic"}>
          <Trash2 size={16} aria-hidden="true" /><span>Delete topic</span>
        </button>
      )}
      <div className="topic-dialog-primary-actions">
        <button type="button" className="secondary-btn topic-dialog-action" onClick={requestClose} disabled={busy}><X size={16} aria-hidden="true" /><span>Cancel</span></button>
        <button type="submit" className="primary-btn topic-dialog-action" disabled={busy} aria-label={submitActionLabel} aria-busy={busy}>
          {busy ? <LoaderCircle className="operation-spinner" size={17} aria-hidden="true" /> : isEdit ? <Save size={17} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
          <span>{submitActionLabel}</span>
        </button>
      </div>
    </div>
    {isEdit && (
      <p className="form-hint topic-dialog-delete-hint">
        {(topic?.noteCount ?? 0) > 0
          ? `This topic contains ${topic?.noteCount} ${topic?.noteCount === 1 ? "note" : "notes"}. Move or delete its notes before deleting the topic.`
          : "This topic has no notes and can be deleted."}
      </p>
    )}
    </form>
  </section>
    {confirmation && <ConfirmationDialog
      options={confirmation === "discard"
        ? {
            eyebrow: isEdit ? "Unsaved topic changes" : "Unsaved changes",
            title: isEdit ? "Discard your edits?" : "Discard this topic?",
            description: isEdit
              ? "Your unsaved topic details and selected replacement cover will be discarded. The saved topic will remain unchanged."
              : "Your topic details and selected cover image have not been saved. Close this dialog and discard your changes?",
            cancelLabel: "Keep editing",
            confirmLabel: "Discard changes",
            tone: "neutral",
          }
        : confirmation === "remove-cover"
          ? {
              eyebrow: "Remove cover image",
              title: "Remove this topic cover?",
              description: "The saved cover image will be removed from this topic. You can choose a replacement at any time.",
              cancelLabel: "Keep cover",
              confirmLabel: "Remove cover",
              tone: "neutral",
            }
          : {
              eyebrow: "Delete topic",
              title: "Delete this topic?",
              description: "Its cover image and collection details will be permanently deleted. This action cannot be undone.",
              cancelLabel: "Keep topic",
              confirmLabel: "Delete topic",
              tone: "danger",
            }}
      onCancel={() => setConfirmation(null)}
      onConfirm={() => {
        const action = confirmation;
        setConfirmation(null);
        if (action === "discard") onClose();
        else if (action === "remove-cover") void removeExistingCover();
        else if (action === "delete") void deleteTopic();
      }}
    />}
  </div>; 
}
