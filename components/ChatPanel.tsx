"use client";

import { Conversation, Message } from "@/types";
import { useEffect, useRef, useState } from "react";

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MediaContent({ m }: { m: Message }) {
  const type = m.message_type;
  const url = m.media_url;
  const filename = m.filename;
  const caption = m.media_caption;
  const linkUrl = m.link_url;

  // The DB stores the local disk path (e.g. "C:\Users\...\uploads\...")
  // in media_url — a browser can't load that directly, so every
  // element below points at this streaming proxy instead, which reads
  // the file from disk and serves it over HTTP.
  const proxyUrl = url ? `/api/media/${m.id}` : null;

  // Plain text — nothing to render here
  if (!type || type === "text") return null;

  // URL / link message
  if (type === "text" && linkUrl) {
    return (
      <a
        href={linkUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block underline text-xs break-all mb-1"
      >
        🔗 {linkUrl}
      </a>
    );
  }

  // No local path yet — show placeholder
  if (!proxyUrl) {
    const icons: Record<string, string> = {
      image: "📸", video: "🎥", audio: "🎵",
      document: "📄", sticker: "😊",
    };
    return (
      <p className="text-xs italic opacity-70 mb-1">
        {icons[type] ?? "📎"} {filename || type} — processing…
      </p>
    );
  }

  if (type === "image" || type === "sticker") {
    return (
      <div className="mb-1">
        <img
          src={proxyUrl}
          alt={caption || "Image"}
          className="max-w-full rounded-lg"
          style={{ maxHeight: 280 }}
        />
        {caption && (
          <p className="mt-1 text-sm whitespace-pre-wrap">{caption}</p>
        )}
      </div>
    );
  }

  if (type === "video") {
    return (
      <div className="mb-1">
        <video
          controls
          className="max-w-full rounded-lg"
          style={{ maxHeight: 280 }}
        >
          <source src={proxyUrl} />
          Your browser does not support video.
        </video>
        {caption && (
          <p className="mt-1 text-sm whitespace-pre-wrap">{caption}</p>
        )}
      </div>
    );
  }

  if (type === "audio") {
    return (
      <div className="mb-1">
        <audio controls className="w-full">
          <source src={proxyUrl} />
          Your browser does not support audio.
        </audio>
      </div>
    );
  }

  if (type === "document") {
    return (
      <div className="mb-1">
        <a
          href={proxyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 underline text-sm break-all"
        >
          <span>📄</span>
          <span>{filename || "Download document"}</span>
        </a>
        {caption && (
          <p className="mt-1 text-sm whitespace-pre-wrap">{caption}</p>
        )}
      </div>
    );
  }

  return null;
}

export default function ChatPanel({
  conversation,
  messages,
  onModeChange,
  onSend,
}: {
  conversation: Conversation | null;
  messages: Message[];
  onModeChange: (mode: "agent" | "human") => void;
  onSend: (content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    setShowContactInfo(false);
  }, [conversation?.id]);

  if (!conversation) {
    return (
      <div className="flex h-screen flex-1 flex-col overflow-hidden bg-panel items-center justify-center">
        <p className="max-w-xs text-center text-sm text-ash">
          Select a conversation on the left to view the chat thread.
        </p>
      </div>
    );
  }

  const isHuman = conversation.mode === "human";

  async function handleSend() {
    const content = draft.trim();
    if (!content || sending || !isHuman) return;
    setSending(true);
    setDraft("");
    try {
      await onSend(content);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden bg-panel">

      {/* Fixed header */}
      <div className="relative shrink-0 flex items-center justify-between border-b border-wire bg-panel px-6 py-4">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">
            {conversation.name || conversation.phone}
          </h2>

          <button
            onClick={() => setShowContactInfo((v) => !v)}
            className="mt-0.5 text-xs text-ash underline decoration-dotted hover:text-ink"
          >
            Contact info
          </button>

          {showContactInfo && (
            <>
              {/* Click-away backdrop */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowContactInfo(false)}
              />
              <div className="absolute left-6 top-16 z-20 w-64 rounded-lg border border-wire bg-white p-4 shadow-lg">
                <p className="text-xs uppercase tracking-wide text-ash">
                  Name
                </p>
                <p className="mb-3 text-sm text-ink">
                  {conversation.name || "—"}
                </p>

                <p className="text-xs uppercase tracking-wide text-ash">
                  Phone number
                </p>
                <p className="font-mono text-sm text-ink">
                  +{conversation.phone}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              isHuman ? "bg-clay/15 text-clay" : "bg-moss/15 text-moss"
            }`}
          >
            {isHuman ? "Human" : "Agent"}
          </span>

          <button
            onClick={() => onModeChange(isHuman ? "agent" : "human")}
            className="rounded-full border border-wire bg-white px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-moss"
          >
            Switch to {isHuman ? "Agent" : "Human"}
          </button>
        </div>
      </div>

      {/* Scrollable messages only */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {messages.map((m) => {
            const fromUser = m.role === "user";
            const fromHuman = m.sender === "human";
            const isMedia = m.message_type && m.message_type !== "text";

            return (
              <div
                key={m.id}
                className={`flex ${fromUser ? "justify-start" : "justify-end"}`}
              >
                <div
                  className={`max-w-[75%] rounded-bubble px-4 py-2.5 text-sm leading-relaxed ${
                    fromUser
                      ? "bg-white text-ink"
                      : fromHuman
                      ? "bg-clay text-panel"
                      : "bg-moss text-panel"
                  }`}
                >
                  {/* Render actual media — image, video, audio, doc */}
                  {isMedia && <MediaContent m={m} />}

                  {/* Link in text message */}
                  {m.link_url && m.message_type === "text" && (
                    <a
                      href={m.link_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block underline text-xs break-all mb-1"
                    >
                      🔗 {m.link_url}
                    </a>
                  )}

                  {/* Text content */}
                  {m.content && (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}

                  <span
                    className={`mt-1 block font-mono text-[10px] ${
                      fromUser
                        ? "text-ash"
                        : fromHuman
                        ? "text-panel/70"
                        : "text-sprout"
                    }`}
                  >
                    {timeLabel(m.created_at)}
                    {!fromUser && (fromHuman ? " · You" : " · AI")}
                  </span>
                </div>
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Fixed composer */}
      <div className="shrink-0 border-t border-wire bg-panel px-6 py-4">
        {!isHuman && (
          <p className="mb-2 text-xs text-ash">
            The AI agent is handling this conversation. Switch to Human mode
            to send a message yourself.
          </p>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              isHuman ? "Type a reply…" : "Switch to Human mode to reply…"
            }
            rows={1}
            disabled={!isHuman}
            className="max-h-32 flex-1 resize-none rounded-lg border border-wire bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ash focus:border-moss focus:outline-none disabled:cursor-not-allowed disabled:bg-panel disabled:text-ash"
          />

          <button
            onClick={handleSend}
            disabled={!isHuman || !draft.trim() || sending}
            className="rounded-lg bg-moss px-4 py-2.5 text-sm font-medium text-panel transition-opacity disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}