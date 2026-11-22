"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { detectTextLanguage } from "@/lib/bidi";

export function TopicDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("Personal");
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>(["Personal", "Philosophy", "Science", "Technology", "Research", "Reading", "Work"]);
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/topics", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.topics)) return;
        const existing = data.topics
          .map((topic: { category?: unknown }) => typeof topic.category === "string" ? topic.category.trim() : "")
          .filter(Boolean);
        setCategorySuggestions((current) =>
          Array.from(new Map([...current, ...existing].map((value) => [value.toLocaleLowerCase(), value])).values())
            .sort((a, b) => a.localeCompare(b)),
        );
      })
      .catch(() => {
        // Built-in suggestions and free-text categories remain available offline.
      });
    return () => controller.abort();
  }, []);
  function chooseFile(next: File | null) {(next: File | null) {
    if (!next) return;
    if (!next.type.startsWith("image/")) return setError("Choose an image file for the topic cover.");
    if (next.size > 8 * 1024 * 1024) return setError("The cover image must be 8 MB or smaller.");
    setError(""); setFile(next); setPreview(URL.createObjectURL(next));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError("");
    if (!title.trim()) return setError("Give your topic a title.");
    setBusy(true);
    try {
      const response = await fetch("/api/topics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, subject, category: category.trim(), description }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create topic.");
      if (file) {
        const form = new FormData(); form.append("file", file);
        const coverResponse = await fetch(`/api/topics/${data.topic.id}/cover`, { method: "POST", body: form });
        const coverData = await coverResponse.json();
        if (!coverResponse.ok) throw new Error(coverData.error || "Topic was created, but its cover could not be uploaded. Edit the topic to try again.");
      }
      router.refresh(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="topic-modal-title">
    <div className="modal-head"><div><div className="eyebrow">Add to your archive</div><h2 className="modal-title" id="topic-modal-title">Create a topic</h2><p className="modal-subtitle">Give a subject a considered home.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></div>
    <form onSubmit={submit}><div className="form-grid">
      <div className="form-field full"><label className="form-label">Topic title *</label><input dir="auto" lang={detectTextLanguage(title)} className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Architecture of Thought" maxLength={120} required autoFocus /></div>
      <div className="form-field"><label className="form-label">Subject</label><input dir="auto" lang={detectTextLanguage(subject)} className="field" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="A short subtitle" maxLength={120} /></div>
      <div className="form-field"><label className="form-label" htmlFor="new-topic-category">Category</label><input id="new-topic-category" list="topic-category-suggestions" className="field" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Choose or create a category" maxLength={60}/><datalist id="topic-category-suggestions">{categorySuggestions.map((item) => <option key={item} value={item}/>)}</datalist><span className="form-hint">Choose an existing category or type a new one. New categories become available after you create this topic.</span></div>
      <div className="form-field full"><label className="form-label">Description</label><textarea dir="auto" lang={detectTextLanguage(description)} className="textarea-field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What belongs in this collection?" maxLength={1000} /></div>
      <div className="form-field full"><label className="form-label">Custom thumbnail</label><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} /><button type="button" className="cover-upload" onClick={() => fileRef.current?.click()}>{preview ? <><img src={preview} alt="Cover preview" /><span className="cover-upload-text"><strong style={{ color: "var(--text)" }}>{file?.name}</strong><br />Click to replace cover · 8 MB maximum</span></> : <><span className="brand-mark"><ImagePlus /></span><span className="cover-upload-text"><strong style={{ color: "var(--text)" }}>Choose a cover image</strong><br />PNG, JPEG, WebP or GIF · up to 8 MB</span><UploadCloud size={18} /></>}</button></div>
    </div>{error && <p className="error-text">{error}</p>}<div className="form-actions"><button type="button" className="secondary-btn" onClick={onClose}>Cancel</button><button type="submit" className="primary-btn" disabled={busy}>{busy ? "Creating…" : "Create topic"}</button></div></form>
  </section></div>;
}
