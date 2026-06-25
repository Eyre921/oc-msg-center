/** Minimal filename <-> content-type mapping for inbound media we download. */

const BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  amr: "audio/amr",
  silk: "audio/silk",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
};

const BY_TYPE: Record<string, string> = Object.entries(BY_EXT).reduce(
  (acc, [ext, type]) => {
    if (!acc[type]) acc[type] = ext;
    return acc;
  },
  {} as Record<string, string>,
);

/** Guess a content-type from a filename or path extension. */
export function guessContentType(nameOrPath: string): string {
  const ext = nameOrPath.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? "application/octet-stream";
}

/** Best-effort file extension (with leading dot) for a content-type. */
export function extForContentType(contentType: string): string {
  const base = (contentType || "").split(";")[0].trim().toLowerCase();
  const ext = BY_TYPE[base] ?? base.split("/")[1];
  return ext ? `.${ext.replace(/[^a-z0-9]+/g, "")}` : "";
}
