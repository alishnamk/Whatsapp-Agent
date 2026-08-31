import { getSupabaseServerClient } from "@/lib/supabase";
import fs from "fs";
import { NextRequest } from "next/server";
import { Readable } from "stream";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const supabase = getSupabaseServerClient();

  const { data: message, error } = await supabase
    .from("messages")
    .select("media_url, mime_type, filename")
    .eq("id", messageId)
    .maybeSingle();

  if (error || !message?.media_url) {
    return new Response("Media not found", { status: 404 });
  }

  const filePath = message.media_url;
  const contentType = message.mime_type || "application/octet-stream";

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response("File not found on disk", { status: 404 });
  }

  const range = req.headers.get("range");

  const disposition = message.filename
    ? `inline; filename="${message.filename.replace(/"/g, "")}"`
    : "inline";

  if (range) {
    const match = /bytes=(\d+)-(\d*)/.exec(range);
    const start = match ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    const nodeStream = fs.createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(
      nodeStream
    ) as unknown as ReadableStream;

    return new Response(webStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": contentType,
        "Content-Disposition": disposition,
      },
    });
  }

  const nodeStream = fs.createReadStream(filePath);
  const webStream = Readable.toWeb(
    nodeStream
  ) as unknown as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Length": String(stat.size),
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Disposition": disposition,
    },
  });
}