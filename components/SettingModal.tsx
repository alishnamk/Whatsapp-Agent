"use client";

import { useEffect, useState } from "react";

export default function SettingsModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [reportRecipient, setReportRecipient] = useState("");
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
          setReportRecipient(data.report_recipient_number ?? "");
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
          report_recipient_number: reportRecipient,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Failed to save.");
        return;
      }

      setPath(data.media_storage_path ?? "");
      setReportRecipient(data.report_recipient_number ?? "");
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
          Local folder where receipts get saved. Files are organized as
          <span className="text-panel">
            {" "}
            path/conversations/&#123;phone&#125;/receipts/&#123;file&#125;
          </span>
          .
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
          Send reports to (WhatsApp number)
        </label>
        <p className="mb-3 text-xs text-ash">
          The number that receives the monthly receipts report, e.g. from{" "}
          <span className="text-panel">/api/send-report</span>. Digits only,
          with country code — no + or spaces needed.
        </p>

        {loading ? (
          <p className="py-2 text-sm text-ash">Loading…</p>
        ) : (
          <input
            value={reportRecipient}
            onChange={(e) => setReportRecipient(e.target.value)}
            placeholder="917025054889"
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
