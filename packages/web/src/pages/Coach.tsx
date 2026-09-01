import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@fc/shared";
import { api } from "../lib/api.js";

interface Props {
  planId: string | undefined;
}

const SUGGESTIONS = [
  "Why did you pick these exercises?",
  "My lower back is tight — what should I change?",
  "How do I get my first pull-up?",
  "Am I progressing on squats?",
];

export function Coach({ planId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threadId, setThreadId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setDraft("");
    setError(undefined);
    setSending(true);

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const result = await api.chat(trimmed, threadId, planId);
      setThreadId(result.threadId);
      setMessages((current) => [...current, result.reply]);
    } catch (e) {
      setError((e as Error).message);
      // Put the text back so it is not lost.
      setMessages((current) => current.filter((m) => m.id !== optimistic.id));
      setDraft(trimmed);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <h1>Coach</h1>
      <p className="sub">
        Ask about your training. Every message here costs tokens — building a
        session on its own doesn't.
      </p>

      {error && <div className="banner banner--error">{error}</div>}

      {!messages.length && (
        <div className="field">
          <label className="field__label">Try asking</label>
          <div className="chips">
            {SUGGESTIONS.map((suggestion) => (
              <button key={suggestion} className="chip" onClick={() => void send(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="chat">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`bubble bubble--${message.role === "user" ? "user" : "coach"}`}
          >
            {message.content}
          </div>
        ))}
        {sending && (
          <div className="bubble bubble--coach">
            <span className="spinner" />
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <input
          type="text"
          className="grow"
          value={draft}
          placeholder="Ask the coach…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send(draft);
          }}
        />
        <button
          className="btn btn--primary btn--sm"
          onClick={() => void send(draft)}
          disabled={sending || !draft.trim()}
        >
          Send
        </button>
      </div>
    </>
  );
}
