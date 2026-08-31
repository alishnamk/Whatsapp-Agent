"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";
import ChatPanel from "@/components/ChatPanel";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { Conversation, ConversationWithLastMessage, Message } from "@/types";

const FALLBACK_POLL_MS = 20 * 1000;

function upsertConversation(
  list: ConversationWithLastMessage[],
  incoming: ConversationWithLastMessage
): ConversationWithLastMessage[] {
  const existing = list.find((c) => c.id === incoming.id);

  const merged = existing ? { ...existing, ...incoming } : incoming;

  const next = existing
    ? list.map((c) => (c.id === incoming.id ? merged : c))
    : [...list, merged];

  // Newest activity first, same ordering the API returns.
  return next.sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

export default function DashboardPage() {
  const [conversations, setConversations] = useState<ConversationWithLastMessage[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());

  // Realtime callbacks are registered once (see the subscription
  // effect below) but need the latest activeId — a ref avoids
  // tearing down and recreating the socket every time the user
  // switches conversations, which could otherwise miss events
  // during the brief resubscribe window.
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;

      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch (err) {
      // Keep whatever we already have on screen rather than
      // wiping the sidebar on a transient network error.
      console.error("Failed to load conversations", err);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`);
      if (!res.ok) return;

      const data = await res.json();

      // The API now returns the complete message object,
      // including media information when available.
      setMessages(data.messages ?? []);
    } catch (err) {
      console.error("Failed to load messages", err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages and clear unread when active conversation changes
  useEffect(() => {
    if (activeId) {
      loadMessages(activeId);

      setUnreadIds((prev) => {
        const next = new Set(prev);
        next.delete(activeId);
        return next;
      });
    } else {
      setMessages([]);
    }
  }, [activeId, loadMessages]);

  // Realtime subscriptions.
  // Subscribed once for the life of the page — activeId is read
  // via activeIdRef so switching conversations never tears down
  // and recreates the socket.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel("dashboard-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          // Supabase sends the complete inserted row here.
          // This includes the new media fields when they exist.
          const newMessage = payload.new as Message;

          if (newMessage.conversation_id === activeIdRef.current) {
            // Message is in the open conversation — append it.
            setMessages((prev) =>
              prev.some((m) => m.id === newMessage.id)
                ? prev
                : [...prev, newMessage]
            );
          }

          // Patch the sidebar preview locally instead of
          // re-fetching the whole conversation list over the
          // network on every single message.
          setConversations((prev) => {
            const conv = prev.find((c) => c.id === newMessage.conversation_id);
            if (!conv) return prev;

            if (
              conv.mode === "human" &&
              newMessage.role === "user" &&
              newMessage.conversation_id !== activeIdRef.current
            ) {
              setUnreadIds((u) => {
                const next = new Set(u);
                next.add(newMessage.conversation_id);
                return next;
              });
            }

            return upsertConversation(prev, {
              ...conv,
              last_message: newMessage.content,
              last_message_role: newMessage.role,
              updated_at: newMessage.created_at,
            });
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          // A brand-new conversation (first message from a new
          // contact) — add it straight to the sidebar. The row
          // is created before its first message, so there's no
          // preview yet; the messages INSERT handler above fills
          // it in moments later.
          const newConversation = payload.new as Conversation;

          setConversations((prev) =>
            upsertConversation(prev, {
              ...newConversation,
              last_message: null,
              last_message_role: null,
            })
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
        },
        (payload) => {
          const updated = payload.new as Conversation;

          setConversations((prev) => {
            const existing = prev.find((c) => c.id === updated.id);
            if (!existing) return prev;

            return upsertConversation(prev, { ...existing, ...updated });
          });
        }
      )
      .subscribe();

    // Fallback poll — a safety net in case the realtime socket
    // ever drops (network changes, tab backgrounding, etc.)
    // without the client noticing.
    const pollId = setInterval(loadConversations, FALLBACK_POLL_MS);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pollId);
    };
  }, [loadConversations]);

  const activeConversation: Conversation | null =
    conversations.find((c) => c.id === activeId) ?? null;

  async function handleModeChange(mode: "agent" | "human") {
    if (!activeId) return;

    const res = await fetch(`/api/conversations/${activeId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });

    if (!res.ok) {
      console.error("Failed to update conversation mode");
      return;
    }

    const data = await res.json();

    // Apply the change immediately from the mutation's own
    // response — don't wait on the realtime UPDATE event, which
    // patches the same state redundantly if/when it also arrives.
    if (data.conversation) {
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === data.conversation.id);
        if (!existing) return prev;

        return upsertConversation(prev, { ...existing, ...data.conversation });
      });
    }
  }

  async function handleSend(content: string) {
    if (!activeId) return;

    const res = await fetch(`/api/conversations/${activeId}/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    const data = await res.json();

    if (data.message) {
      setMessages((prev) =>
        prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]
      );
    }

    // The resulting `messages` INSERT is picked up by the
    // realtime subscription above, which also patches the
    // sidebar preview — no manual refetch needed.
  }

  function handleSelect(id: string) {
    setActiveId(id);

    setUnreadIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  return (
    <main className="flex h-screen w-full overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        unreadIds={unreadIds}
      />

      <ChatPanel
        conversation={activeConversation}
        messages={messages}
        onModeChange={handleModeChange}
        onSend={handleSend}
      />
    </main>
  );
}