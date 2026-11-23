"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Check, Eraser, LoaderCircle, PenLine, RotateCcw, RotateCw, X } from "lucide-react";

type Point = { x: number; y: number; pressure: number };
type Stroke = { color: string; width: number; points: Point[] };

type Props = {
  onClose: () => void;
  onInsert: (file: File) => void;
};

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  const points = stroke.points;
  if (!points.length) return;

  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (points.length === 1) {
    const point = points[0];
    const radius = Math.max(0.8, stroke.width * (0.3 + point.pressure * 0.45));
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    return;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    context.lineWidth = Math.max(1.2, stroke.width * (0.42 + point.pressure * 0.85));
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
}

export function NoteHandwritingPad({ onClose, onInsert }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const redoRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const exportingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const onInsertRef = useRef(onInsert);
  onCloseRef.current = onClose;
  onInsertRef.current = onInsert;
  exportingRef.current = exporting;

  const [inkColor, setInkColor] = useState("#202936");
  const [lineWidth, setLineWidth] = useState(2.6);
  const [allowTouch, setAllowTouch] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.round(bounds.width * ratio);
    const height = Math.round(bounds.height * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = "#FFFCF5";
    context.fillRect(0, 0, bounds.width, bounds.height);
    strokesRef.current.forEach((stroke) => drawStroke(context, stroke));
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const canvas = canvasRef.current;
    const observer = canvas ? new ResizeObserver(redraw) : null;
    if (canvas && observer) observer.observe(canvas);
    redraw();

    const frame = window.requestAnimationFrame(() => canvas?.focus());
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !exportingRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      document.removeEventListener("keydown", handleKeyDown, true);
      previouslyFocused?.focus();
    };
  }, [redraw]);

  const getPoint = (event: PointerEvent | ReactPointerEvent<HTMLCanvasElement>, bounds: DOMRect): Point => ({
    x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    pressure: event.pressure > 0 ? Math.min(1, event.pressure) : 0.5,
  });

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (exporting || (event.pointerType === "touch" && !allowTouch) || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = getPoint(event, bounds);
    const stroke: Stroke = { color: inkColor, width: lineWidth, points: [point] };
    activeStrokeRef.current = stroke;
    event.currentTarget.setPointerCapture(event.pointerId);

    const context = event.currentTarget.getContext("2d");
    if (context) drawStroke(context, stroke);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStrokeRef.current;
    if (!stroke || exporting) return;
    event.preventDefault();

    const bounds = event.currentTarget.getBoundingClientRect();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent];
    const context = event.currentTarget.getContext("2d");
    if (!context) return;

    for (const sample of samples) {
      const point = getPoint(sample, bounds);
      const previous = stroke.points[stroke.points.length - 1];
      stroke.points.push(point);
      drawStroke(context, { ...stroke, points: [previous, point] });
    }
  }

  function finishStroke() {
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    strokesRef.current.push(stroke);
    redoRef.current = [];
    activeStrokeRef.current = null;
    setCanUndo(strokesRef.current.length > 0);
    setCanRedo(false);
  }

  function undo() {
    if (activeStrokeRef.current) finishStroke();
    const stroke = strokesRef.current.pop();
    if (!stroke) return;
    redoRef.current.push(stroke);
    setCanUndo(strokesRef.current.length > 0);
    setCanRedo(true);
    redraw();
  }

  function redo() {
    const stroke = redoRef.current.pop();
    if (!stroke) return;
    strokesRef.current.push(stroke);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
    redraw();
  }

  function clearCanvas() {
    activeStrokeRef.current = null;
    strokesRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    setNotice("");
    redraw();
  }

  async function insertHandwriting() {
    const canvas = canvasRef.current;
    if (!canvas || exporting) return;
    if (activeStrokeRef.current) finishStroke();
    if (strokesRef.current.length === 0) {
      setNotice("Write something on the page before adding it to your note.");
      return;
    }

    setExporting(true);
    setNotice("");
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error("The handwriting image could not be prepared."));
        }, "image/png");
      });
      const file = new File([blob], "handwriting-" + new Date().toISOString().replace(/[:.]/g, "-") + ".png", {
        type: "image/png",
        lastModified: Date.now(),
      });
      onCloseRef.current();
      onInsertRef.current(file);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The handwriting image could not be prepared.");
      setExporting(false);
    }
  }

  return createPortal(
    <div className="handwriting-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !exporting) onClose();
    }}>
      <section className="handwriting-dialog" role="dialog" aria-modal="true" aria-labelledby="handwriting-title" aria-describedby="handwriting-help" aria-busy={exporting}>
        <header className="handwriting-header">
          <div className="handwriting-heading-copy">
            <span className="eyebrow">NATURAL INPUT</span>
            <h2 id="handwriting-title">Write by hand</h2>
            <p id="handwriting-help">Use your phone stylus to write. Enable finger input below if your device reports a passive stylus as touch. Your strokes are added as an image.</p>
          </div>
          <button type="button" className="handwriting-close" onClick={onClose} disabled={exporting} aria-label="Close handwriting pad" title="Close">
            <X size={19} aria-hidden="true" />
          </button>
        </header>

        <div className="handwriting-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="handwriting-canvas"
            aria-label="Handwriting area. Write using your stylus or finger."
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            onLostPointerCapture={finishStroke}
          />
          <span className="handwriting-paper-label" aria-hidden="true">MNEMOSYNE · HANDWRITTEN NOTE</span>
        </div>

        <div className="handwriting-tools" role="toolbar" aria-label="Handwriting tools">
          <label className="handwriting-ink-control">
            <span>Ink</span>
            <input type="color" value={inkColor} onChange={(event) => setInkColor(event.target.value)} disabled={exporting} aria-label="Ink color" />
          </label>
          <label className="handwriting-touch-control">
            <input type="checkbox" checked={allowTouch} onChange={(event) => setAllowTouch(event.target.checked)} disabled={exporting} />
            <span>Finger input</span>
          </label>
          <label className="handwriting-width-control">
            <span>Pen width</span>
            <input type="range" min="1.2" max="6" step="0.2" value={lineWidth} onChange={(event) => setLineWidth(Number(event.target.value))} disabled={exporting} aria-label="Pen width" />
          </label>
          <button type="button" className="handwriting-tool-button" onClick={undo} disabled={!canUndo || exporting} aria-label="Undo last stroke" title="Undo">
            <RotateCcw size={17} aria-hidden="true" />
          </button>
          <button type="button" className="handwriting-tool-button" onClick={redo} disabled={!canRedo || exporting} aria-label="Redo stroke" title="Redo">
            <RotateCw size={17} aria-hidden="true" />
          </button>
          <button type="button" className="handwriting-tool-button handwriting-clear-button" onClick={clearCanvas} disabled={!canUndo || exporting} aria-label="Clear handwriting" title="Clear">
            <Eraser size={17} aria-hidden="true" />
          </button>
        </div>

        {notice && <p className="handwriting-notice" role="status">{notice}</p>}
        <footer className="handwriting-actions">
          <button type="button" className="secondary-btn" onClick={onClose} disabled={exporting}>Cancel</button>
          <button type="button" className="primary-btn" onClick={() => void insertHandwriting()} disabled={!canUndo || exporting}>
            {exporting ? <LoaderCircle className="operation-spinner" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            <span>{exporting ? "Preparing…" : "Add to note"}</span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
