"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ImagePlus, LoaderCircle, Save, Trash2, X } from "lucide-react";
import { detectTextLanguage } from "@/lib/bidi";
import { OperationStatus, notifyOperation } from "@/components/operation-status";
import { UploadProgress } from "@/components/upload-progress";
import { uploadFormDataWithProgress } from "@/lib/upload-form-data";
import { useConfirmation } from "@/components/confirmation-dialog";

type Topic = {
  id: string;
  title: string;
  subject: string;
  description: string;
  category: string;
  coverUrl: string | null;
  noteCount: number;
};

export function TopicEditForm({ topic, categories = [] }: { topic: Topic; categories?: string[] }) {
  const router = useRouter();
  const { confirm: requestConfirmation, dialog: confirmationDialog } = useConfirmation();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [title, setTitle] = useState(topic.title);
  const [subject, setSubject] = useState(topic.subject);
  const [description, setDescription] = useState(topic.description);
  const [category, setCategory] = useState(topic.category || "Personal");
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>(categories);
  const [categorySuggestionsError, setCategorySuggestionsError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(topic.coverUrl ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

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

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setProcessingMessage("Saving topic details…");

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
        const coverResponse = await uploadFormDataWithProgress<{ error?: string }>(`/api/topics/${topic.id}/cover`, form, (progress) => setUploadProgress(progress.percentage));
        const coverData = coverResponse.data;
        if (!coverResponse.ok) {
          throw new Error(coverData?.error || "Topic details were saved, but the cover image could not be uploaded.");
        }
      }

      notifyOperation("success", file ? "Topic details and cover image saved." : "Topic details saved successfully.");
      router.push(`/topics/${topic.id}`);
      router.refresh();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save topic.";
      setError(message);
    } finally {
      setBusy(false);
      setProcessingMessage("");
      setUploadProgress(null);
    }
  }

  async function remove() {
    if (busy) return;
    const accepted = await requestConfirmation({
      eyebrow: "Delete topic",
      title: "Delete this topic?",
      description: "Topics with notes cannot be deleted. This action cannot be undone.",
      confirmLabel: "Delete topic",
      tone: "danger",
    });
    if (!accepted) return;
    setBusy(true);
    setError("");
    setProcessingMessage("Deleting topic…");

    try {
      const response = await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete topic.");

      notifyOperation("success", "Topic deleted successfully.");
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

  async function removeCover() {
    if (busy) return;
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
        <form onSubmit={save}>
          <div className="form-grid">
            <div className="form-field full">
              <label className="form-label" htmlFor="edit-topic-title">Topic title *</label>
              <input id="edit-topic-title" dir="auto" lang={detectTextLanguage(title)} className="field" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} disabled={busy} />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="edit-topic-subject">Subject</label>
              <input id="edit-topic-subject" dir="auto" lang={detectTextLanguage(subject)} className="field" value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={120} disabled={busy} />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="edit-topic-category">Category</label>
              <input id="edit-topic-category" list="edit-topic-category-suggestions" className="field" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Choose or create a category" maxLength={60} disabled={busy} />
              <datalist id="edit-topic-category-suggestions">
                {Array.from(new Map<string, string>(["Personal", "Philosophy", "Science", "Technology", "Research", "Reading", "Work", "Other", ...categorySuggestions, topic.category].filter(Boolean).map((value): [string, string] => [value.toLocaleLowerCase(), value])).values()).map((value) => <option key={value} value={value} />)}
              </datalist>
              <span className="form-hint">Choose an existing category or type a new one. Your category will appear in the All topics filter when saved.</span>
              {categorySuggestionsError && <OperationStatus kind="failure" message={categorySuggestionsError} compact />}
            </div>
            <div className="form-field full">
              <label className="form-label" htmlFor="edit-topic-description">Description</label>
              <textarea id="edit-topic-description" dir="auto" lang={detectTextLanguage(description)} className="textarea-field" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} disabled={busy} />
            </div>
            <div className="form-field full">
              <label className="form-label">Topic thumbnail</label>
              <input hidden ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={busy} onChange={(event) => { const input = event.currentTarget; chooseCover(input.files?.[0]); input.value = ""; }} />
              <button type="button" className="cover-upload" onClick={() => fileRef.current?.click()} disabled={busy} aria-label={preview ? "Replace topic cover image" : "Choose topic cover image"} title={preview ? "Replace topic cover image" : "Choose topic cover image"}>
                {preview ? <><img src={preview} alt="Topic cover preview" /><ImagePlus size={19} aria-hidden="true" /></> : <ImagePlus size={22} aria-hidden="true" />}<span>{preview ? "Replace cover image" : "Choose cover image"}</span>
              </button>
              {preview && <button type="button" className="secondary-btn icon-only-btn" onClick={removeCover} disabled={busy} aria-label="Remove topic cover" title="Remove topic cover"><Trash2 size={17} /></button>}
            </div>
          </div>

          {busy && <div style={{ marginTop: 15 }}><OperationStatus kind="processing" message={processingMessage} /></div>}
          {uploadProgress !== null && <UploadProgress label="Uploading topic cover" percentage={uploadProgress} detail={file?.name} />}
          {error && <div style={{ marginTop: 12 }}><OperationStatus kind="failure" message={error} /></div>}

          <div className="form-actions" style={{ justifyContent: "space-between" }}>
            <button type="button" className="danger-btn topic-edit-action" onClick={() => void remove()} disabled={busy} aria-label="Delete topic">
              {busy && processingMessage === "Deleting topic…" ? <LoaderCircle className="operation-spinner" size={17} aria-hidden="true" /> : <Trash2 size={17} aria-hidden="true" />}<span>{busy && processingMessage === "Deleting topic…" ? "Deleting…" : "Delete topic"}</span>
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <Link className="secondary-btn topic-edit-action" href={`/topics/${topic.id}`} aria-label="Cancel editing topic" aria-disabled={busy} onClick={(event) => { if (busy) event.preventDefault(); }}><X size={16} aria-hidden="true" /><span>Cancel</span></Link>
              <button className="primary-btn topic-edit-action" type="submit" disabled={busy} aria-label={busy ? "Saving topic changes" : "Save topic changes"}>
                {busy ? <LoaderCircle className="operation-spinner" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}<span>{busy ? "Saving…" : "Save changes"}</span>
              </button>
            </div>
          </div>
          <p className="form-hint" style={{ marginTop: 13 }}>This topic contains {topic.noteCount} notes. To delete it, move or delete its notes first.</p>
        </form>
      </section>
      {confirmationDialog}
    </main>
  );
}
