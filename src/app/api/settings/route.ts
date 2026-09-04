import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getSupabaseServerClient } from "@/lib/supabase";

export async function GET() {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["media_storage_path", "report_recipient_phone"]);

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const byKey = Object.fromEntries(
    (data ?? []).map((row) => [row.key, row.value])
  );

  return NextResponse.json({
    media_storage_path: byKey.media_storage_path ?? null,
    report_recipient_phone: byKey.report_recipient_phone ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const hasMediaPath = typeof body?.media_storage_path === "string";
  const hasReportPhone =
    typeof body?.report_recipient_phone === "string";

  if (!hasMediaPath && !hasReportPhone) {
    return NextResponse.json(
      {
        error:
          "Provide media_storage_path and/or report_recipient_phone as non-empty strings",
      },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();
  const rows: { key: string; value: string; updated_at: string }[] = [];

  if (hasMediaPath) {
    const trimmedPath = body.media_storage_path.trim();

    if (trimmedPath.length === 0) {
      return NextResponse.json(
        { error: "media_storage_path must be a non-empty string" },
        { status: 400 }
      );
    }

    // Confirm the folder can actually be created/written to on this
    // machine before saving it — catching a bad path here beats
    // discovering it later when a real WhatsApp message comes in and
    // silently fails to save.
    try {
      await fs.mkdir(trimmedPath, { recursive: true });
    } catch (err) {
      return NextResponse.json(
        {
          error: `That path isn't accessible: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
        { status: 400 }
      );
    }

    rows.push({ key: "media_storage_path", value: trimmedPath, updated_at: now });
  }

  if (hasReportPhone) {
    // WhatsApp Cloud API wants numbers in international format, no
    // "+", no spaces/dashes — e.g. 917025054889. Light validation
    // only; Meta will reject anything malformed at send time anyway.
    const trimmedPhone = body.report_recipient_phone
      .trim()
      .replace(/[\s+\-()]/g, "");

    if (!/^\d{7,15}$/.test(trimmedPhone)) {
      return NextResponse.json(
        {
          error:
            "report_recipient_phone must be digits only, in international format (e.g. 917025054889)",
        },
        { status: 400 }
      );
    }

    rows.push({
      key: "report_recipient_phone",
      value: trimmedPhone,
      updated_at: now,
    });
  }

  const { error } = await supabase
    .from("app_settings")
    .upsert(rows, { onConflict: "key" });

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["media_storage_path", "report_recipient_phone"]);

  const byKey = Object.fromEntries(
    (data ?? []).map((row) => [row.key, row.value])
  );

  return NextResponse.json({
    media_storage_path: byKey.media_storage_path ?? null,
    report_recipient_phone: byKey.report_recipient_phone ?? null,
  });
}
