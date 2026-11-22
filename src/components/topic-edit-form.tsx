"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ImagePlus, LoaderCircle, Save, Trash2, X } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus, notifyOperation } from "@/components/operation-status";
import { UploadProgress } from "@/components/upload-progress";
import { uploadFormDataWithProgress } from "@/lib/upload-form-data";
import { useConfirmation } from "@/components/confirmation-dialog";

export type EditableTopic = {
  id: string;
  title: string;
  subject: string;
  description: string;
  category: string;
  coverUrl: string | null;
  noteCount: number;
};

type TopicEditFormProps = {
  topic: EditableTopic;
  categories?: string[];
  presentation?: "page" | "dialog";
  onClose?: () => void;
};

export function TopicEditForm({
  topic,
  categories = [],
  presentation = "page",
  onClose,
}: TopicEditFormProps) {
  const router = useRouter();
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const modalRef = useRef<HTMLElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const requestCloseRef = useRef<() => void>(() => undefined);
  const titleId = useId();
  const descriptionId = useId();
  const isDialog = presentation === "dialog";
  const initialCategory = topic.category || "Personal";

  const [title, setTitle] = useState(topic.title);
  const [subject, setSubject] = useState(topic.subject);
  const [description, setDescription] = useState(topic.description);
  const [category, setCategory] = useState(initialCategory);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>(categories);
  const [categorySuggestionsError, setCategorySuggestionsError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(topic.coverUrl ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const hasUnsavedChanges =
    title !== topic.title ||
    subject !== topic.subject ||
    description !== topic.description ||
    category !== initialCategory ||
    file !== null;

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/topics/categories", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
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
        const incoming = data.categories.filter(
          (value: unknown): value is string => typeof value === "string" && value.trim().length > 0,
        );
        setCategorySuggestions((current) =>
          Array.from(
            new Map(
              [...current, ...incoming, topic.category]
                .filter(Boolean)
                .map((value) => [value.toLocaleLowerCase(), value] as const),
            ).values(),
          ).sort((a, b) => a.localeCompare(b)),
        );
        setCategorySuggestionsError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setCategorySuggestionsError(
            cause instanceof Error
              ? cause.message + " Your current category and custom text remain available."
              : "Saved categories could not be loaded. Your current category and custom text remain available.",
          );
        }
      });
    return () => controller.abort();
  }, [topic.category]);

  function requestClose() {
    if (!isDialog || busy) return;
    if (!hasUnsavedChanges) {
      onClose?.();
      return;
    }

    void requestConfirmation({
      eyebrow: "Unsaved topic changes",
      title: "Discard your edits?",
      description: "Your unsaved topic details and selected replacement cover will be discarded. The saved topic will remain unchanged.",
      cancelLabel: "Keep editing",
      confirmLabel: "Discard changes",
      tone: "neutral",
    }).then((accepted) => {
      if (accepted) onClose?.();
    });
  }
  requestCloseRef.current = requestClose;

  useEffect(() => {
    if (!isDialog) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const container = modalRef.current;
    const frame = window.requestAnimationFrame(() => titleInputRef.current?.focus());

    function handleDialogKeys(event: KeyboardEvent) {
      if (!container || !container.contains(document.activeElement)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = container.querySelectorAll<HTMLElement>(
        "button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]):not([type='hidden']), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDialogKeys, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleDialogKeys, true);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [isDialog]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setProcessingMessage("Saving topic details…");

    let saved = false;
    try {
      const response = await fetch(`/api/topics/${topic.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, subject, description, category: category.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save topic details.");

      if (file) {
        setProcessingMessage("Uploading the new topic cover…");
        const form = new FormData();
        form.append("file", file);
        setUploadProgress(0);
        const coverResponse = await uploadFormDataWithProgress<{ error?: string }>(
          `/api/topics/${topic.id}/cover`,
          form,
          (progress) => setUploadProgress(progress.percentage),
        );
        const coverData = coverResponse.data;
        if (!coverResponse.ok) {
          throw new Error(coverData?.error || "Topic details were saved, but the cover image could not be uploaded.");
        }
      }

      notifyOperation("success", file ? "Topic details and cover image saved." : "Topic details saved successfully.");
      saved = true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save topic.";
      setError(message);
    } finally {
      setBusy(false);
      setProcessingMessage("");
      setUploadProgress(null);
    }

    if (saved) {
      if (isDialog) {
        onClose?.();
        router.refresh();
      } else {
        router.push(`/topics/${topic.id}`);
        router.refresh();
      }
    }
  }

  async function remove() {
    if (busy || topic.noteCount > 0) return;
    const accepted = await requestConfirmation({
      eyebrow: "Delete topic",
      title: "Delete this topic?",
      description: "This topic has no notes. Its cover image and collection details will also be permanently deleted. This action cannot be undone.",
      confirmLabel: "Delete topic",
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    setError("");
    setProcessingMessage("Deleting topic…");

    let deleted = false;
    try {
      const response = await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete topic.");

      notifyOperation("success", "Topic deleted successfully.");
      deleted = true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not delete topic.";
      setError(message);
      notifyOperation("failure", message);
    } finally {
      setBusy(false);
      setProcessingMessage("");
    }

    if (deleted) {
      if (isDialog) onClose?.();
      router.push("/topics");
      router.refresh();
    }
  }

  async function removeCover() {
    if (busy) return;
    const accepted = await requestConfirmation({
      eyebrow: "Remove cover image",
      title: "Remove this topic cover?",
      description: "The cover image will be removed from this topic. You can choose a replacement at any time.",
      confirmLabel: "Remove cover",
      tone: "neutral",
    });
    if (!accepted) return;

    setBusy(true);
    setError("");
    setProcessingMessage("Removing topic cover…");

    try {
      const response = await fetch(`/api/topics/${topic.id}/cover`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove topic cover.");

      setFile(null);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
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

  function chooseCover(next: File | undefined) {
    if (!next) return;
    const supportedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const supportedByName = /\.(png|jpe?g|webp|gif)$/i.test(next.name);
    if (!supportedTypes.includes(next.type) && !supportedByName) {
      setError("Use a PNG, JPEG, WebP or GIF image for the topic cover.");
      return;
    }
    if (next.size > 8 * 1024 * 1024) {
      setError("The cover image must be 8 MB or smaller.");
      return;
    }
    setError("");
    setFile(next);
    const nextPreview = URL.createObjectURL(next);
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nextPreview;
    setPreview(nextPreview);
  }

  const form = (
    <form onSubmit={save}>
      <div className="form-grid">
        <div className="form-field full">
          <div className="topic-field-label-row">
            <label className="form-label" htmlFor={isDialog ? "edit-topic-modal-title-input" : "edit-topic-title"}>Topic title</label>
            <span className="topic-field-required">Required</span>
          </div>
          <input
            ref={titleInputRef}
            id={isDialog ? "edit-topic-modal-title-input" : "edit-topic-title"}
            dir="auto"
            lang={detectTextLanguage(title)}
            className="field"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={120}
            disabled={busy}
            aria-describedby={isDialog ? "edit-topic-modal-title-help" : "edit-topic-title-help"}
          />
          <div className="topic-field-meta">
            <span id={isDialog ? "edit-topic-modal-title-help" : "edit-topic-title-help"}>A clear name makes this collection easy to recognize.</span>
            <span className="topic-field-counter">{title.length} / 120</span>
          </div>
        </div>
        <div className="form-field">
          <div className="topic-field-label-row">
            <label className="form-label" htmlFor={isDialog ? "edit-topic-modal-subject" : "edit-topic-subject"}>Subject</label>
            <span className="topic-field-optional">Optional</span>
          </div>
          <input
            id={isDialog ? "edit-topic-modal-subject" : "edit-topic-subject"}
            dir="auto"
            lang={detectTextLanguage(subject)}
            className="field"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={120}
            disabled={busy}
          />
        </div>
        <div className="form-field">
          <div className="topic-field-label-row">
            <label className="form-label" htmlFor={isDialog ? "edit-topic-modal-category" : "edit-topic-category"}>Category</label>
            <span className="topic-field-optional">Optional</span>
          </div>
          <input
            id={isDialog ? "edit-topic-modal-category" : "edit-topic-category"}
            list={isDialog ? "edit-topic-modal-category-suggestions" : "edit-topic-category-suggestions"}
            className="field"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            placeholder="Choose or create a category"
            maxLength={60}
            disabled={busy}
          />
          <datalist id={isDialog ? "edit-topic-modal-category-suggestions" : "edit-topic-category-suggestions"}>
            {Array.from(new Map<string, string>(
              ["Personal", "Philosophy", "Science", "Technology", "Research", "Reading", "Work", "Other", ...categorySuggestions, topic.category]
                .filter(Boolean)
                .map((value): [string, string] => [value.toLocaleLowerCase(), value]),
            ).values()).map((value) => <option key={value} value={value} />)}
          </datalist>
          <span className="form-hint">Choose an existing category or type a new one. Your category will appear in the All topics filter when saved.</span>
          {categorySuggestionsError && <OperationStatus kind="failure" message={categorySuggestionsError} compact />}
        </div>
        <div className="form-field full">
          <div className="topic-field-label-row">
            <label className="form-label" htmlFor={isDialog ? "edit-topic-modal-description" : "edit-topic-description"}>Description</label>
            <span className="topic-field-optional">Optional</span>
          </div>
          <textarea
            id={isDialog ? "edit-topic-modal-description" : "edit-topic-description"}
            dir="auto"
            lang={detectTextLanguage(description)}
            className="textarea-field"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={1000}
            disabled={busy}
          />
          <div className="topic-field-meta">
            <span>A short explanation of what belongs in this collection.</span>
            <span className="topic-field-counter">{description.length} / 1,000</span>
          </div>
        </div>
        <div className="form-field full topic-cover-field">
          <div className="topic-field-label-row">
            <label className="form-label">Topic thumbnail</label>
            <span className="topic-field-optional">Optional</span>
          </div>
          <input
            hidden
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={busy}
            onChange={(event) => {
              const input = event.currentTarget;
              chooseCover(input.files?.[0]);
              input.value = "";
            }}
          />
          <button
            type="button"
            className="cover-upload"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label={preview ? "Replace topic cover image" : "Choose topic cover image"}
            title={preview ? "Replace topic cover image" : "Choose topic cover image"}
          >
            {preview
              ? <><img src={preview} alt="Topic cover preview" /><ImagePlus size={19} aria-hidden="true" /></>
              : <><ImagePlus size={22} aria-hidden="true" /><span>Choose cover image</span></>}
            {preview && <span>Replace cover image</span>}
          </button>
          <span className="topic-field-help">PNG, JPEG, WebP or GIF. Maximum file size: 8 MB.</span>
          {file && (
            <div className="topic-cover-selection" aria-live="polite">
              <span className="topic-cover-selection-icon"><ImagePlus size={15} aria-hidden="true" /></span>
              <span className="topic-cover-selection-info">
                <strong dir="auto">{file.name}</strong>
                <small>{(file.size / (1024 * 1024)).toFixed(1)} MB · Ready to upload when you save changes</small>
              </span>
              <button type="button" className="topic-cover-remove secondary-btn" onClick={() => {
                setFile(null);
                if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
                previewUrlRef.current = null;
                setPreview(topic.coverUrl ?? "");
              }} disabled={busy}>
                <X size={14} aria-hidden="true" /><span>Undo replacement</span>
              </button>
            </div>
          )}
          {preview && (
            <button type="button" className="secondary-btn topic-cover-remove-action" onClick={() => void removeCover()} disabled={busy} aria-label="Remove topic cover">
              <Trash2 size={15} aria-hidden="true" /><span>Remove topic cover</span>
            </button>
          )}
        </div>
      </div>

      {busy && <div style={{ marginTop: 15 }}><OperationStatus kind="processing" message={processingMessage} /></div>}
      {uploadProgress !== null && <UploadProgress label="Uploading topic cover" percentage={uploadProgress} detail={file?.name} />}
      {error && <div style={{ marginTop: 12 }}><OperationStatus kind="failure" message={error} /></div>}

      <div className="form-actions topic-edit-actions" style={{ justifyContent: "space-between" }}>
        <button
          type="button"
          className="danger-btn topic-edit-action"
          onClick={() => void remove()}
          disabled={busy || topic.noteCount > 0}
          aria-label="Delete topic"
          title={topic.noteCount > 0 ? "Move or delete this topic's notes before deleting it" : "Delete topic"}
        >
          {busy && processingMessage === "Deleting topic…" ? <LoaderCircle className="operation-spinner" size={17} aria-hidden="true" /> : <Trash2 size={17} aria-hidden="true" />}
          <span>{busy && processingMessage === "Deleting topic…" ? "Deleting…" : "Delete topic"}</span>
        </button>
        <div className="topic-edit-primary-actions">
          {isDialog ? (
            <button type="button" className="secondary-btn topic-edit-action" onClick={requestClose} disabled={busy}>
              <X size={16} aria-hidden="true" /><span>Cancel</span>
            </button>
          ) : (
            <Link className="secondary-btn topic-edit-action" href={`/topics/${topic.id}`} aria-label="Cancel editing topic" aria-disabled={busy} onClick={(event) => { if (busy) event.preventDefault(); }}>
              <X size={16} aria-hidden="true" /><span>Cancel</span>
            </Link>
          )}
          <button className="primary-btn topic-edit-action" type="submit" disabled={busy} aria-label={busy ? (uploadProgress !== null ? "Uploading topic cover" : "Saving topic changes") : "Save topic changes"} aria-busy={busy}>
            {busy ? <LoaderCircle className="operation-spinner" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
            <span>{busy ? uploadProgress !== null ? "Uploading cover…" : "Saving…" : "Save changes"}</span>
          </button>
        </div>
      </div>
      <p className="form-hint topic-delete-hint" id={isDialog ? "edit-topic-modal-delete-help" : "edit-topic-delete-help"}>
        {topic.noteCount > 0
          ? `This topic contains ${topic.noteCount} ${topic.noteCount === 1 ? "note" : "notes"}. Move or delete its notes before deleting the topic.`
          : "This topic has no notes and can be deleted."}
      </p>
    </form>
  );

  if (isDialog) {
    return (
      <div
        className="topic-edit-dialog-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) requestClose();
        }}
      >
        <section
          ref={modalRef}
          className="modal topic-edit-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={busy}
          tabIndex={-1}
        >
          <div className="topic-edit-dialog-head">
            <div>
              <div className="eyebrow">Collection settings</div>
              <h2 className="modal-title" id={titleId}>Edit topic</h2>
              <p className="modal-subtitle" id={descriptionId}>Update this collection while keeping your place in the archive.</p>
            </div>
            <button type="button" className="icon-button icon-only-btn" onClick={requestClose} aria-label="Close dialog" disabled={busy}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {form}
        </section>
        {confirmationDialog}
      </div>
    );
  }

  return (
    <main className="page">
      <div style={{ marginBottom: 18 }}>
        <Link className="breadcrumb icon-only-btn" href={`/topics/${topic.id}`} aria-label="Back to topic" title="Back to topic"><ArrowLeft size={17} /></Link>
      </div>
      <div className="page-heading">
        <div>
          <div className="eyebrow">Collection settings</div>
          <h1 className="page-title">Edit topic</h1>
          <p className="page-subtitle">Refine the identity and details of this collection.</p>
        </div>
      </div>
      <section className="panel" style={{ maxWidth: 760 }}>
        {form}
      </section>
      {confirmationDialog}
    </main>
  );
}
