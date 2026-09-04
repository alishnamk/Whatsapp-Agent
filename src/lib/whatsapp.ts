import fs from "fs/promises";
import path from "path";

const GRAPH_VERSION = "v22.0";

// Fallback used only if the app_settings row is empty/unreadable —
// see getLocalUploadsRoot() below. The real, developer-configured
// path is stored in Supabase (`app_settings.media_storage_path`) and
// set from the dashboard's Settings modal, not hardcoded here.
const DEFAULT_UPLOADS_ROOT = path.join(process.cwd(), "uploads");

export type WhatsAppMessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "sticker";

export type MediaCategory =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "link"
  | "text";

export interface IncomingMessage {
  from: string;
  text: string | null;
  whatsappMsgId: string;
  contactName: string | null;
  timestamp: string;
  type: WhatsAppMessageType;
  mediaId: string | null;
  mimeType: string | null;
  filename: string | null;
  caption: string | null;
  sha256: string | null;
}

interface WhatsAppSendResult {
  ok: boolean;
  status: number;
  body: unknown;
}

const BUCKET_MAP: Record<string, MediaCategory> = {
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/png": "image",
  "image/gif": "image",
  "image/webp": "image",
  "image/heic": "image",
  "image/heif": "image",
  "image/bmp": "image",
  "image/tiff": "image",
  "image/svg+xml": "image",

  "video/mp4": "video",
  "video/mpeg": "video",
  "video/quicktime": "video",
  "video/x-msvideo": "video",
  "video/x-matroska": "video",
  "video/webm": "video",
  "video/3gpp": "video",
  "video/x-ms-wmv": "video",
  "video/ogg": "video",

  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "audio/ogg": "audio",
  "audio/wav": "audio",
  "audio/x-wav": "audio",
  "audio/aac": "audio",
  "audio/mp4": "audio",
  "audio/amr": "audio",
  "audio/webm": "audio",
  "audio/opus": "audio",
  "audio/x-m4a": "audio",

  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "document",
  "application/vnd.apple.pages": "document",
  "application/vnd.apple.numbers": "document",
  "application/vnd.apple.keynote": "document",
  "application/vnd.oasis.opendocument.text": "document",
  "application/vnd.oasis.opendocument.spreadsheet": "document",
  "application/vnd.oasis.opendocument.presentation": "document",
  "text/plain": "document",
  "text/csv": "document",
  "application/rtf": "document",
  "application/json": "document",
  "application/xml": "document",
  "application/zip": "document",
  "application/x-zip-compressed": "document",
  "application/x-rar-compressed": "document",
  "application/x-7z-compressed": "document",
};

const EXTENSION_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",

  "video/mp4": "mp4",
  "video/mpeg": "mpeg",
  "video/quicktime": "mov",
  "video/x-msvideo": "avi",
  "video/x-matroska": "mkv",
  "video/webm": "webm",
  "video/3gpp": "3gp",
  "video/x-ms-wmv": "wmv",

  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/amr": "amr",
  "audio/webm": "weba",
  "audio/opus": "opus",
  "audio/x-m4a": "m4a",

  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.apple.pages": "pages",
  "application/vnd.apple.numbers": "numbers",
  "application/vnd.apple.keynote": "key",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/rtf": "rtf",
  "application/zip": "zip",
  "application/x-rar-compressed": "rar",
  "application/x-7z-compressed": "7z",
};

export function getMediaCategory(
  mimeType: string | null
): MediaCategory {
  if (!mimeType) return "document";

  const clean = mimeType.toLowerCase().split(";")[0].trim();

  return BUCKET_MAP[clean] ?? "document";
}

function getExtension(
  mimeType: string | null,
  filename: string | null
): string {
  if (filename) {
    const parts = filename.split(".");

    if (parts.length > 1) {
      return parts[parts.length - 1].toLowerCase();
    }
  }

  if (!mimeType) return "bin";

  const clean = mimeType.toLowerCase().split(";")[0].trim();

  return EXTENSION_MAP[clean] ?? "bin";
}

/*
 * Media categories that are actually saved to disk. This is an
 * invoice/receipt intake system: we only keep photos and documents
 * (the things that can actually be a receipt/invoice). Audio,
 * video, stickers, and links are never written to local storage.
 */
const SAVED_CATEGORIES: MediaCategory[] = ["image", "document"];

function isSavableCategory(
  category: MediaCategory
): boolean {
  return SAVED_CATEGORIES.includes(category);
}

/*
 * YYYY-MM-DD for the receipt filename, derived from the WhatsApp
 * message timestamp (unix seconds, as a string). Falls back to
 * "now" if the timestamp is missing/unparseable — a save should
 * never fail just because of a bad date.
 */
function formatReceiptDate(timestamp: string | null): string {
  const seconds = Number(timestamp);

  const date =
    timestamp && !Number.isNaN(seconds)
      ? new Date(seconds * 1000)
      : new Date();

  return date.toISOString().slice(0, 10);
}

/*
 * Filesystem-safe version of a wamid — these are base64-ish and can
 * contain characters (e.g. "=") that are fine on Linux/macOS but
 * best avoided for portability. Anything outside letters/digits/dot/
 * dash/underscore becomes "_".
 */
function sanitizeForFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

/*
 * Receipt filename: <date>-<wamid>.<extension>
 * e.g. 2026-09-03-wamid.HBgM...A.jpg
 */
function buildReceiptFilename(
  timestamp: string | null,
  whatsappMsgId: string,
  extension: string
): string {
  const date = formatReceiptDate(timestamp);
  const safeId = sanitizeForFilename(whatsappMsgId);

  return `${date}-${safeId}.${extension}`;
}

/*
 * Read the developer-configured media storage path from Supabase
 * (`app_settings.media_storage_path`), set via the dashboard's
 * Settings modal. Falls back to ./uploads if the row is empty or the
 * query fails for any reason — media should still get saved even if
 * the settings table isn't reachable.
 */
export async function getLocalUploadsRoot(
  supabase: any
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "media_storage_path")
      .maybeSingle();

    if (!error && data?.value) {
      return data.value;
    }
  } catch (err) {
    console.error(
      "getLocalUploadsRoot error, falling back to default:",
      err
    );
  }

  return DEFAULT_UPLOADS_ROOT;
}

/*
 * Save a downloaded media buffer to the local filesystem, organized:
 *
 *   {uploadsRoot}/conversations/{conversationNumber}/receipts/{filename}
 *
 * Every conversation gets one "receipts" folder — photos and
 * documents are saved together there (no per-type subfolders
 * anymore). filename is expected to already be in the
 * <date>-<wamid>.<ext> shape from buildReceiptFilename().
 *
 * uploadsRoot comes from getLocalUploadsRoot() above, so it reflects
 * whatever path the developer set in the Settings UI — not a
 * hardcoded value.
 *
 * The conversation folder is created only once per conversation —
 * fs.mkdir(..., { recursive: true }) is a safe no-op if it already
 * exists, it never recreates or errors. Never throws — a local save
 * failure should not break the rest of the message flow.
 */
async function saveMediaLocally(
  buffer: Buffer,
  uploadsRoot: string,
  conversationNumber: string,
  filename: string
): Promise<string | null> {
  try {
    const destPath = path.join(
      uploadsRoot,
      "conversations",
      conversationNumber,
      "receipts",
      filename
    );

    await fs.mkdir(path.dirname(destPath), {
      recursive: true,
    });

    await fs.writeFile(destPath, buffer);

    return destPath;
  } catch (err) {
    console.error(
      "saveMediaLocally error:",
      err
    );

    return null;
  }
}

export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  try {
    // Get the actual media URL from Meta
    const metaRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!metaRes.ok) {
      console.error(
        "Failed to get media URL from Meta:",
        await metaRes.text()
      );

      return null;
    }

    const metaData = await metaRes.json();

    if (!metaData.url) {
      console.error(
        "No URL in Meta media response:",
        metaData
      );

      return null;
    }

    // Download the actual media file
    const fileRes = await fetch(metaData.url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!fileRes.ok) {
      console.error(
        "Failed to download media file:",
        fileRes.status
      );

      return null;
    }

    const mimeType =
      metaData.mime_type ||
      fileRes.headers.get("content-type") ||
      "application/octet-stream";

    const buffer = Buffer.from(
      await fileRes.arrayBuffer()
    );

    return {
      buffer,
      mimeType,
    };
  } catch (err) {
    console.error(
      "downloadWhatsAppMedia error:",
      err
    );

    return null;
  }
}

export async function uploadMediaToStorage(
  supabase: any,
  incoming: IncomingMessage
): Promise<{
  mediaUrl: string | null;
  mediaCategory: MediaCategory;
  localPath: string | null;
}> {
  const mediaCategory = getMediaCategory(
    incoming.mimeType
  );

  if (!incoming.mediaId) {
    return {
      mediaUrl: null,
      mediaCategory,
      localPath: null,
    };
  }

  // Receipt intake only cares about photos and documents. Video,
  // audio, and stickers are recognized/stored as messages (see the
  // webhook), but we never download or save their bytes to disk.
  if (!isSavableCategory(mediaCategory)) {
    return {
      mediaUrl: null,
      mediaCategory,
      localPath: null,
    };
  }

  // Download media from Meta
  const downloaded = await downloadWhatsAppMedia(
    incoming.mediaId
  );

  if (!downloaded) {
    return {
      mediaUrl: null,
      mediaCategory,
      localPath: null,
    };
  }

  const { buffer, mimeType } = downloaded;

  const category = getMediaCategory(mimeType);

  // Re-check against the real downloaded mime type, in case it
  // differs from what the webhook payload claimed.
  if (!isSavableCategory(category)) {
    return {
      mediaUrl: null,
      mediaCategory: category,
      localPath: null,
    };
  }

  const extension = getExtension(
    mimeType,
    incoming.filename
  );

  // <date>-<wamid>.<ext> — all receipts for a conversation land
  // together in one "receipts" folder, see saveMediaLocally.
  const localFilename = buildReceiptFilename(
    incoming.timestamp,
    incoming.whatsappMsgId,
    extension
  );

  // Save the actual bytes locally, organized:
  // {uploadsRoot}/conversations/{phone}/receipts/{date-wamid.ext}.
  // This reuses the buffer we already downloaded above — no second
  // fetch from Meta. We no longer upload the file itself to
  // Supabase Storage — only the local path is kept, and that path is
  // what gets written into the `messages.media_url` column in
  // Supabase (Postgres), so Supabase still holds the reference even
  // though the file lives on disk. uploadsRoot comes from the
  // developer's Settings UI, not a hardcoded path.
  const uploadsRoot = await getLocalUploadsRoot(supabase);

  const localPath = await saveMediaLocally(
    buffer,
    uploadsRoot,
    incoming.from,
    localFilename
  );

  if (localPath) {
    console.log(
      `✅ Receipt saved locally: ${localPath}`
    );
  } else {
    console.error(
      "❌ Local receipt save failed"
    );
  }

  return {
    mediaUrl: localPath,
    mediaCategory: category,
    localPath,
  };
}

/*
 * Upload a local file to WhatsApp so it can be attached to an
 * outgoing message. Returns the WhatsApp media id (NOT a URL) —
 * that id is what gets referenced in the template send below.
 * Uses the environment's built-in FormData/Blob (Node 18+), no
 * extra multipart library needed.
 */
export async function uploadWhatsAppOutgoingMedia(
  filePath: string,
  mimeType: string
): Promise<string | null> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN env vars"
    );
  }

  try {
    const buffer = await fs.readFile(filePath);
    const filename = path.basename(filePath);

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([buffer], { type: mimeType }), filename);
    form.append("type", mimeType);

    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: form,
      }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.id) {
      console.error("uploadWhatsAppOutgoingMedia failed:", res.status, data);
      return null;
    }

    return data.id as string;
  } catch (err) {
    console.error("uploadWhatsAppOutgoingMedia error:", err);
    return null;
  }
}

/*
 * Send a pre-approved WhatsApp message TEMPLATE with a document
 * attached. Templates are required for business-initiated messages
 * outside the 24-hour customer service window (e.g. an automated
 * monthly report nobody asked for in the last 24h) — see Meta's
 * WhatsApp Business Platform docs. The template must already be
 * approved in WhatsApp Manager with a document header and one body
 * text variable (used here for the month label).
 */
export async function sendWhatsAppDocumentTemplate(
  to: string,
  templateName: string,
  mediaId: string,
  filename: string,
  bodyText: string
): Promise<WhatsAppSendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN env vars"
    );
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en_US" },
          components: [
            {
              type: "header",
              parameters: [
                {
                  type: "document",
                  document: { id: mediaId, filename },
                },
              ],
            },
            {
              type: "body",
              parameters: [{ type: "text", text: bodyText }],
            },
          ],
        },
      }),
    }
  );

  const responseBody = await res.json().catch(() => null);

  if (!res.ok) {
    console.error(
      "WhatsApp template send failed",
      res.status,
      responseBody
    );
  }

  return {
    ok: res.ok,
    status: res.status,
    body: responseBody,
  };
}

/*
 * Send a document as a plain WhatsApp message (not a template). This
 * only works if the recipient has messaged the business number
 * within the last 24 hours (WhatsApp's "customer service window") —
 * outside that window, use sendWhatsAppDocumentTemplate instead. For
 * an on-demand report sent to your own number, this is usually fine.
 */
export async function sendWhatsAppDocumentMessage(
  to: string,
  mediaId: string,
  filename: string,
  caption?: string
): Promise<WhatsAppSendResult> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN env vars"
    );
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          id: mediaId,
          filename,
          ...(caption ? { caption } : {}),
        },
      }),
    }
  );

  const responseBody = await res.json().catch(() => null);

  if (!res.ok) {
    console.error(
      "WhatsApp document send failed",
      res.status,
      responseBody
    );
  }

  return {
    ok: res.ok,
    status: res.status,
    body: responseBody,
  };
}

export async function sendWhatsAppMessage(
  to: string,
  body: string
): Promise<WhatsAppSendResult> {
  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID;

  const accessToken =
    process.env.WHATSAPP_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    throw new Error(
      "Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN env vars"
    );
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body,
          preview_url: false,
        },
      }),
    }
  );

  const responseBody = await res
    .json()
    .catch(() => null);

  if (!res.ok) {
    console.error(
      "WhatsApp send failed",
      res.status,
      responseBody
    );
  }

  return {
    ok: res.ok,
    status: res.status,
    body: responseBody,
  };
}

export function parseIncomingMessage(
  payload: any
): IncomingMessage | null {
  try {
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return null;

    const contact = value?.contacts?.[0];
    const type = message.type as WhatsAppMessageType;

    const supportedTypes: WhatsAppMessageType[] = [
      "text",
      "image",
      "video",
      "audio",
      "document",
      "sticker",
    ];

    if (!supportedTypes.includes(type)) {
      console.log(
        `Unsupported WhatsApp message type: ${message.type}`
      );

      return null;
    }

    let text: string | null = null;
    let mediaId: string | null = null;
    let mimeType: string | null = null;
    let filename: string | null = null;
    let caption: string | null = null;
    let sha256: string | null = null;

    if (type === "text") {
      text = message.text?.body ?? "";
    }

    if (type === "image") {
      mediaId = message.image?.id ?? null;
      mimeType = message.image?.mime_type ?? null;
      caption = message.image?.caption ?? null;
      sha256 = message.image?.sha256 ?? null;
    }

    if (type === "video") {
      mediaId = message.video?.id ?? null;
      mimeType = message.video?.mime_type ?? null;
      caption = message.video?.caption ?? null;
      sha256 = message.video?.sha256 ?? null;
    }

    if (type === "audio") {
      mediaId = message.audio?.id ?? null;
      mimeType = message.audio?.mime_type ?? null;
      sha256 = message.audio?.sha256 ?? null;
    }

    if (type === "document") {
      mediaId = message.document?.id ?? null;
      mimeType = message.document?.mime_type ?? null;
      filename = message.document?.filename ?? null;
      caption = message.document?.caption ?? null;
      sha256 = message.document?.sha256 ?? null;
    }

    if (type === "sticker") {
      mediaId = message.sticker?.id ?? null;
      mimeType = message.sticker?.mime_type ?? null;
      sha256 = message.sticker?.sha256 ?? null;
    }

    return {
      from: message.from,
      text,
      whatsappMsgId: message.id,
      contactName: contact?.profile?.name ?? null,
      timestamp: message.timestamp,
      type,
      mediaId,
      mimeType,
      filename,
      caption,
      sha256,
    };
  } catch (err) {
    console.error(
      "Failed to parse WhatsApp webhook payload",
      err
    );

    return null;
  }
}

// NOTE: Links are intentionally not saved to local storage anymore.
// This is a receipts/invoice intake system — only photos and
// documents are persisted to disk (see isSavableCategory above).
// Incoming URLs are still detected in the webhook for informational
// purposes (stored as `link_url` on the message row), but no file is
// written for them.