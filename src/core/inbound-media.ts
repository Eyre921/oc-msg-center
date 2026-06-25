/**
 * Pulls the user's text AND any media references out of an inbound OpenAI
 * chat-completion request. openclaw routes a colleague's QQ/WeChat messages to
 * msg-center's agent endpoint; when they send a picture or file it arrives as
 * structured `messages[].content` parts (and sometimes as a path/URL inside the
 * envelope text). We extract every reference so the file can be downloaded and
 * kept on the server permanently.
 */

export interface ChatMessage {
  role: string;
  content: unknown;
}

export interface ExtractedInbound {
  /** Concatenated text of the last user message (still enveloped). */
  text: string;
  /** Distinct media references: data: URIs, file:// or absolute paths, http(s) URLs. */
  media: string[];
}

export function extractInbound(messages: ChatMessage[]): ExtractedInbound {
  const last = lastUserMessage(messages);
  const texts: string[] = [];
  const media: string[] = [];
  const push = (ref: unknown) => {
    if (typeof ref !== "string") return;
    const r = ref.trim();
    if (r && isIngestable(r) && !media.includes(r)) media.push(r);
  };

  if (last) {
    if (typeof last.content === "string") {
      texts.push(last.content);
    } else if (Array.isArray(last.content)) {
      for (const part of last.content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, any>;
        switch (p.type) {
          case "text":
            if (typeof p.text === "string") texts.push(p.text);
            break;
          case "image_url":
            push(typeof p.image_url === "string" ? p.image_url : p.image_url?.url);
            break;
          case "image":
          case "input_image":
            push(p.url ?? (typeof p.image_url === "string" ? p.image_url : p.image_url?.url) ?? p.source);
            break;
          case "file":
          case "input_file": {
            const f = (p.file ?? {}) as Record<string, any>;
            push(f.file_data ?? p.file_url ?? p.url ?? f.file_url ?? f.url ?? p.path ?? p.source);
            break;
          }
          default:
            break;
        }
      }
    }
  }

  const text = texts.join("\n").trim();

  // Belt-and-braces: also harvest references embedded in the envelope text —
  // inline data URIs, explicit [附件:/attachment:/file:] markers, and absolute
  // paths that point at openclaw's own media/download cache (single-image
  // deploy shares the disk). We deliberately do NOT download arbitrary URLs a
  // user merely typed, to avoid surprises.
  for (const m of text.matchAll(/data:[^\s"'<>]+/gi)) push(m[0]);
  for (const m of text.matchAll(/\[(?:附件|文件|attachment|file)\s*[:：]\s*([^\]]+)\]/gi)) push(m[1].trim());
  for (const m of text.matchAll(/(?:file:\/\/)?(\/[^\s"'<>]*(?:\.openclaw|\/downloads\/|\/media\/)[^\s"'<>]+)/gi))
    push(m[0]);

  return { text, media };
}

export function isIngestable(ref: string): boolean {
  return (
    ref.startsWith("data:") ||
    ref.startsWith("file://") ||
    ref.startsWith("http://") ||
    ref.startsWith("https://") ||
    ref.startsWith("/")
  );
}

function lastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return messages[messages.length - 1];
}
