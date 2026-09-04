"use client";

import { useMemo, useState } from "react";
import { ConversationWithLastMessage } from "@/types";
import SettingsModal from "./SettingModal";

function timeLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "2-digit", month: "short" });
}

function matchesQuery(c: ConversationWithLastMessage, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const nameMatch = (c.name ?? "").toLowerCase().includes(normalized);

  // Let people search by digits regardless of how they type the
  // number (with/without spaces, +, dashes, etc).
  const digitsOnlyQuery = normalized.replace(/\D/g, "");
  const phoneMatch = digitsOnlyQuery
    ? c.phone.replace(/\D/g, "").includes(digitsOnlyQuery)
    : c.phone.toLowerCase().includes(normalized);

  return nameMatch || phoneMatch;
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  unreadIds,
}: {
  conversations: ConversationWithLastMessage[];
  activeId: string | null;
  onSelect: (id: string) => void;
  unreadIds: Set<string>;
}) {
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const filtered = useMemo(
    () => conversations.filter((c) => matchesQuery(c, query)),
    [conversations, query]
  );

  const humanConvs = filtered.filter((c) => c.mode === "human");
  const agentConvs = filtered.filter((c) => c.mode === "agent");
  const isSearching = query.trim().length > 0;

  function renderConv(c: ConversationWithLastMessage) {
    const active = c.id === activeId;
    const hasUnread = unreadIds.has(c.id);

    return (
      <button
        key={c.id}
        onClick={() => onSelect(c.id)}
        className={`group flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
          active ? "bg-[#16241E]" : "hover:bg-[#141F1A]"
        }`}
      >
        <span
          className={`mt-1 h-8 w-[3px] shrink-0 rounded-full ${
            c.mode === "agent" ? "bg-moss2" : "bg-clay"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium text-panel">
              {c.name || c.phone}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-ash">
              {timeLabel(c.updated_at)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1 mt-0.5">
            <p className="truncate text-sm text-ash">
              {c.last_message_role === "assistant" ? "↳ " : ""}
              {c.last_message || "No messages yet"}
            </p>
            {hasUnread && (
              <span className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-clay text-[9px] font-bold text-white">
                !
              </span>
            )}
          </div>
        </div>
      </button>
    );
  }

  return (
    <aside className="flex h-full w-[340px] shrink-0 flex-col overflow-hidden border-r border-wireDark bg-ink">

      {/* Header — never scrolls */}
      <div className="shrink-0 flex items-center gap-2 px-5 py-5">
        <div className="h-2 w-2 rounded-full bg-sprout" />
        <h1 className="font-display text-lg font-semibold tracking-tight text-panel">
          Swayaan
        </h1>
        <span className="font-mono text-[11px] text-ash">console</span>

        <div className="ml-auto flex items-center gap-2">
          {unreadIds.size > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-clay text-[10px] font-bold text-white">
              {unreadIds.size}
            </span>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="More options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-7 w-7 items-center justify-center rounded-full text-ash hover:bg-[#16241E] hover:text-panel"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </button>

            {menuOpen && (
              <>
                {/* Click-outside catcher */}
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-lg border border-wireDark bg-[#141F1A] py-1 shadow-lg"
                >
                  <button
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setSettingsOpen(true);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm text-panel hover:bg-[#1c2b23]"
                  >
                    Settings
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {settingsOpen && (
        <SettingsModal onClose={() => setSettingsOpen(false)} />
      )}

      {/* Search — never scrolls */}
      <div className="shrink-0 px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg bg-[#141F1A] px-3 py-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-ash"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or start new chat"
            className="w-full bg-transparent text-sm text-panel placeholder:text-ash focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="shrink-0 text-ash hover:text-panel"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Conversation list — only this scrolls */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {conversations.length === 0 && (
          <p className="px-3 py-6 text-sm text-ash">
            No conversations yet. They&rsquo;ll show up here the moment
            someone messages your WhatsApp number.
          </p>
        )}

        {conversations.length > 0 && isSearching && filtered.length === 0 && (
          <p className="px-3 py-6 text-sm text-ash">
            No conversations found for &ldquo;{query}&rdquo;.
          </p>
        )}

        {humanConvs.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-widest text-clay">
              Needs your reply
            </p>
            {humanConvs.map(renderConv)}
          </>
        )}

        {agentConvs.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-widest text-ash">
              Agent handling
            </p>
            {agentConvs.map(renderConv)}
          </>
        )}
      </div>
    </aside>
  );
}