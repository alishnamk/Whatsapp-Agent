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
 * Local disk folder name per media category. Kept separate from
 * getBucketName() (Supabase bucket names) since the local layout is
 * organized conversation-first, not type-first.
 */
function getLocalCategoryFolder(
  category: MediaCategory
): string {
  const map: Partial<Record<MediaCategory, string>> = {
    image: "images",
    video: "videos",
    audio: "audio",
    document: "documents",
    link: "documents",
  };

  return map[category] ?? "documents";
}

/*
 * Read the developer-configured media storage path from Supabase
 * (`app_settings.media_storage_path`), set via the dashboard's
 * Settings modal. Falls back to ./uploads if the row is empty or the
 * query fails for any reason — media should still get saved even if
 * the settings table isn't reachable.
 */
async function getLocalUploadsRoot(
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
 * Save a downloaded media buffer to the local filesystem, organized
 * conversation-first: {uploadsRoot}/{phone}/{category}/{filename}
 *
 * uploadsRoot comes from getLocalUploadsRoot() above, so it reflects
 * whatever path the developer set in the Settings UI — not a
 * hardcoded value.
 *
 * The conversation folder ({uploadsRoot}/{phone}) is created only
 * once per conversation — fs.mkdir(..., { recursive: true }) is a
 * safe no-op if it already exists, it never recreates or errors.
 * Never throws — a local save failure should not break the rest of
 * the message flow.
 */
async function saveMediaLocally(
  buffer: Buffer,
  uploadsRoot: string,
  phone: string,
  category: MediaCategory,
  filename: string
): Promise<string | null> {
  try {
    const destPath = path.join(
      uploadsRoot,
      phone,
      getLocalCategoryFolder(category),
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

  const extension = getExtension(
    mimeType,
    incoming.filename
  );

  // Local filename only — the phone number becomes the conversation
  // folder, see saveMediaLocally.
  const localFilename = incoming.filename
    ? `${incoming.whatsappMsgId}_${incoming.filename}`
    : `${incoming.whatsappMsgId}.${extension}`;

  // Save the actual bytes locally, organized conversation-first:
  // {uploadsRoot}/{phone}/{category}/{filename}. This reuses the
  // buffer we already downloaded above — no second fetch from Meta.
  // We no longer upload the file itself to Supabase Storage — only
  // the local path is kept, and that path is what gets written into
  // the `messages.media_url` column in Supabase (Postgres), so
  // Supabase still holds the reference even though the file lives on
  // disk. uploadsRoot comes from the developer's Settings UI, not a
  // hardcoded path.
  const uploadsRoot = await getLocalUploadsRoot(supabase);

  const localPath = await saveMediaLocally(
    buffer,
    uploadsRoot,
    incoming.from,
    category,
    localFilename
  );

  if (localPath) {
    console.log(
      `✅ Media saved locally: ${localPath}`
    );
  } else {
    console.error(
      "❌ Local media save failed"
    );
  }

  return {
    mediaUrl: localPath,
    mediaCategory: category,
    localPath,
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

export async function uploadLinkToStorage(
  supabase: any,
  incoming: IncomingMessage,
  url: string
): Promise<string | null> {
  try {
    // Saved locally as {uploadsRoot}/{phone}/documents/{whatsappMsgId}.txt
    // — same conversation-first layout as media, using the
    // developer-configured path. No Supabase Storage bucket
    // involved; the returned local path is what gets written into
    // `messages.media_url` in Supabase (Postgres).
    const localFilename = `${incoming.whatsappMsgId}.txt`;

    const uploadsRoot = await getLocalUploadsRoot(supabase);

    const localPath = await saveMediaLocally(
      Buffer.from(url, "utf-8"),
      uploadsRoot,
      incoming.from,
      "link",
      localFilename
    );

    if (localPath) {
      console.log(
        `✅ Link saved locally: ${localPath}`
      );
    } else {
      console.error(
        "❌ Local link save failed"
      );
    }

    return localPath;
  } catch (error) {
    console.error("uploadLinkToStorage error:", error);
    return null;
  }
}