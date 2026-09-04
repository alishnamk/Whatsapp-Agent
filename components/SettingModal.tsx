"use client";

import { useEffect, useState } from "react";

export default function SettingsModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [reportPhone, setReportPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/settings");
        const data = await res.json();

        if (!cancelled) {
          setPath(data.media_storage_path ?? "");
          setReportPhone(data.report_recipient_phone ?? "");
        }
      } catch (err) {
        if (!cancelled) {
          setError("Couldn't load the current setting.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          media_storage_path: path,
          report_recipient_phone: reportPhone,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to save.");
        return;
      }

      setPath(data.media_storage_path ?? "");
      setReportPhone(data.report_recipient_phone ?? "");
      setSaved(true);
    } catch (err) {
      setError("Failed to save — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-wireDark bg-ink p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-panel">
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ash hover:text-panel"
          >
            ✕
          </button>
        </div>

        <label className="mb-1 block font-mono text-[11px] uppercase tracking-widest text-ash">
          Media storage path
        </label>
        <p className="mb-3 text-xs text-ash">
          Please provide a Local folder path where you would like to save downloaded WhatsApp media (images, videos,
          audio, documents). Files are organized as
          <span className="text-panel"> path/&#123;phone&#125;/&#123;type&#125;/&#123;file&#125;</span>.
        </p>

        {loading ? (
          <p className="py-2 text-sm text-ash">Loading…</p>
        ) : (
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\Users\Admin\Desktop\WA-Agent-2\uploads"
            className="w-full rounded-lg border border-wireDark bg-[#141F1A] px-3 py-2 text-sm text-panel placeholder:text-ash focus:outline-none"
          />
        )}

        <label className="mb-1 mt-4 block font-mono text-[11px] uppercase tracking-widest text-ash">
          Report recipient (WhatsApp number)
        </label>
        <p className="mb-3 text-xs text-ash">
          The generated weekly report is sent here as soon as it's ready.
          International format, digits only — no
          <span className="text-panel"> +</span>, spaces, or dashes (e.g.
          <span className="text-panel"> 918970733399</span>).
        </p>

        {loading ? (
          <p className="py-2 text-sm text-ash">Loading…</p>
        ) : (
          <input
            value={reportPhone}
            onChange={(e) => setReportPhone(e.target.value)}
            placeholder="918970733399"
            className="w-full rounded-lg border border-wireDark bg-[#141F1A] px-3 py-2 text-sm text-panel placeholder:text-ash focus:outline-none"
          />
        )}

        {error && (
          <p className="mt-2 text-xs text-clay">{error}</p>
        )}

        {saved && !error && (
          <p className="mt-2 text-xs text-sprout">Saved.</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-ash hover:text-panel"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || saving}
            className="rounded-lg bg-moss2 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
