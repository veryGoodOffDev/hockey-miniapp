import React, { useMemo, useState } from "react";

const DEFAULT_EMOJIS = ["😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤔", "😮", "😢", "😡", "👍", "👎", "👏", "🙏", "🔥", "❤️", "🎉", "💯", "🥶", "🥳"];

export function Emoji({ emoji, unified, size = 16 }) {
  const value = String(emoji || unified || "").trim();
  return <span style={{ fontSize: size, lineHeight: 1 }}>{value}</span>;
}

export default function EmojiPicker({
  reactions = [],
  allowExpandReactions = true,
  reactionsDefaultOpen = true,
  onReactionClick,
  onEmojiClick,
}) {
  const [expanded, setExpanded] = useState(!reactionsDefaultOpen);
  const quick = useMemo(() => (Array.isArray(reactions) && reactions.length ? reactions : DEFAULT_EMOJIS.slice(0, 8)), [reactions]);
  const full = useMemo(() => Array.from(new Set([...quick, ...DEFAULT_EMOJIS])), [quick]);
  const data = expanded ? full : quick;

  function pick(emoji) {
    const payload = { emoji, unified: emoji };
    if (typeof onReactionClick === "function") onReactionClick(payload);
    else if (typeof onEmojiClick === "function") onEmojiClick(payload);
  }

  return (
    <div style={{ border: "1px solid rgba(255,255,255,.16)", borderRadius: 12, padding: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {data.map((emo) => (
          <button key={emo} type="button" className="reactPickBtn" onClick={() => pick(emo)}>
            {emo}
          </button>
        ))}
      </div>
      {allowExpandReactions ? (
        <button type="button" className="btn secondary" style={{ marginTop: 10 }} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Скрыть" : "Ещё"}
        </button>
      ) : null}
    </div>
  );
}
