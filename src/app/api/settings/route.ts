import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getSupabaseServerClient } from "@/lib/supabase";

const SETTINGS_KEYS = [
  "media_storage_path",
  "report_recipient_number",
] as const;

export async function GET() {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", SETTINGS_KEYS);

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
    report_recipient_number: byKey.report_recipient_number ?? null,
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const updates: { key: string; value: string }[] = [];

  // --- media_storage_path (unchanged behavior) ---
  if (body?.media_storage_path !== undefined) {
    const mediaPath = body.media_storage_path;

    if (typeof mediaPath !== "string" || mediaPath.trim().length === 0) {
      return NextResponse.json(
        { error: "media_storage_path must be a non-empty string" },
        { status: 400 }
      );
    }

    const trimmedPath = mediaPath.trim();

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

    updates.push({ key: "media_storage_path", value: trimmedPath });
  }

  // --- report_recipient_number ---
  if (body?.report_recipient_number !== undefined) {
    const number = body.report_recipient_number;

    if (typeof number !== "string" || number.trim().length === 0) {
      return NextResponse.json(
        { error: "report_recipient_number must be a non-empty string" },
        { status: 400 }
      );
    }

    // Light validation only — WhatsApp numbers are E.164-ish (digits,
    // optionally a leading +). We don't try to fully validate a phone
    // number here, just catch obvious typos.
    const trimmedNumber = number.trim();

    if (!/^\+?[0-9]{7,15}$/.test(trimmedNumber)) {
      return NextResponse.json(
        {
          error:
            "That doesn't look like a valid WhatsApp number (digits only, with country code, e.g. 917025054889).",
        },
        { status: 400 }
      );
    }

    updates.push({
      key: "report_recipient_number",
      value: trimmedNumber,
    });
  }

  if (updates.length === 0) {
    return NextResponse.json(
      { error: "No recognized settings provided" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServerClient();

  const { error } = await supabase
    .from("app_settings")
    .upsert(
      updates.map((u) => ({
        key: u.key,
        value: u.value,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "key" }
    );

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  const { data, error: readError } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", SETTINGS_KEYS);

  if (readError) {
    return NextResponse.json(
      { error: readError.message },
      { status: 500 }
    );
  }

  const byKey = Object.fromEntries(
    (data ?? []).map((row) => [row.key, row.value])
  );

  return NextResponse.json({
    media_storage_path: byKey.media_storage_path ?? null,
    report_recipient_number: byKey.report_recipient_number ?? null,
  });
}
