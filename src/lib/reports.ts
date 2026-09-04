import fs from "fs/promises";
import path from "path";
import ExcelJS from "exceljs";
import pdfParse from "pdf-parse";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// A vision-capable model is required here — the default chat model
// (OPENROUTER_MODEL) is free/text-only and can't read images. Override
// with OPENROUTER_REPORT_MODEL if you want a different one.
const REPORT_MODEL =
  process.env.OPENROUTER_REPORT_MODEL || "anthropic/claude-3.5-sonnet";

export interface ReceiptRecord {
  filePath: string;
  filename: string;
  conversationNumber: string; // the phone-number folder it came from
  readable: boolean;
  merchant: string | null;
  date: string | null; // YYYY-MM-DD, as printed on the receipt
  currency: string | null;
  total: number | null;
  category: string | null;
}

interface ExtractedReceipt {
  readable: boolean;
  merchant: string | null;
  date: string | null;
  currency: string | null;
  total: number | null;
  category: string | null;
}

const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
]);

function getMimeTypeForExtension(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  return map[ext] ?? "application/octet-stream";
}

/*
 * Walk {uploadsRoot}/conversations/{phone}/receipts/* and return every
 * receipt file found, tagged with which conversation folder it came
 * from. Never throws — a missing/unreadable folder just yields no
 * receipts rather than crashing the whole report.
 */
export async function listAllReceiptFiles(
  uploadsRoot: string
): Promise<{ filePath: string; filename: string; conversationNumber: string }[]> {
  const conversationsRoot = path.join(uploadsRoot, "conversations");

  const results: {
    filePath: string;
    filename: string;
    conversationNumber: string;
  }[] = [];

  let conversationDirs: string[] = [];

  try {
    conversationDirs = await fs.readdir(conversationsRoot);
  } catch (err) {
    console.error(
      "listAllReceiptFiles: could not read conversations root",
      err
    );
    return results;
  }

  for (const conversationNumber of conversationDirs) {
    const receiptsDir = path.join(
      conversationsRoot,
      conversationNumber,
      "receipts"
    );

    let files: string[] = [];

    try {
      files = await fs.readdir(receiptsDir);
    } catch {
      // No receipts folder for this conversation — skip it.
      continue;
    }

    for (const filename of files) {
      results.push({
        filePath: path.join(receiptsDir, filename),
        filename,
        conversationNumber,
      });
    }
  }

  return results;
}

/*
 * Ask the AI model to read one receipt file and pull out the fields we
 * need. Images go in as base64 vision input. PDFs go through text
 * extraction first (pdf-parse) — this only works for PDFs that have a
 * real text layer, not scanned/photographed PDFs with no embedded
 * text. A PDF with too little extractable text is marked unreadable
 * rather than guessed at.
 */
export async function extractReceiptData(
  filePath: string
): Promise<ExtractedReceipt> {
  const unreadable: ExtractedReceipt = {
    readable: false,
    merchant: null,
    date: null,
    currency: null,
    total: null,
    category: null,
  };

  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

  const instructions = `You are reading a single purchase receipt or invoice. Reply with ONLY a JSON object, no other text, in this exact shape:
{"readable": true|false, "merchant": string|null, "date": "YYYY-MM-DD"|null, "currency": string|null, "total": number|null, "category": string|null}

- "date" is the purchase date PRINTED on the receipt itself, formatted YYYY-MM-DD.
- "currency" is the 3-letter code if you can tell (e.g. INR, USD); otherwise your best guess from symbols; null if truly unclear.
- "total" is the final total amount as a plain number (no currency symbol, no commas).
- "category" is a short reasonable spending category inferred from the merchant/items (e.g. "Groceries", "Fuel", "Dining", "Office Supplies").
- If the content is too blurry, cut off, not a receipt, or otherwise unreadable, set "readable": false and leave the other fields null. Do not guess numbers.`;

  let userContent: any;

  if (IMAGE_EXTENSIONS.has(ext)) {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString("base64");
    const mimeType = getMimeTypeForExtension(ext);

    userContent = [
      { type: "text", text: instructions },
      {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${base64}` },
      },
    ];
  } else if (ext === "pdf") {
    const buffer = await fs.readFile(filePath);

    let text = "";

    try {
      const parsed = await pdfParse(buffer);
      text = (parsed.text || "").trim();
    } catch (err) {
      console.error("extractReceiptData: pdf-parse failed", filePath, err);
    }

    // Too little text almost always means a scanned/photographed PDF
    // with no real text layer — we don't do image OCR here, so treat
    // it as unreadable rather than guessing.
    if (text.length < 20) {
      return unreadable;
    }

    userContent = `${instructions}\n\nReceipt text:\n${text}`;
  } else {
    return unreadable;
  }

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: REPORT_MODEL,
          messages: [{ role: "user", content: userContent }],
          max_tokens: 500,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("extractReceiptData: OpenRouter error", data);
      return unreadable;
    }

    const raw: string | undefined =
      data?.choices?.[0]?.message?.content?.trim();

    if (!raw) return unreadable;

    // Models sometimes wrap JSON in ```json fences despite instructions.
    const cleaned = raw.replace(/```json|```/g, "").trim();

    const parsed = JSON.parse(cleaned);

    return {
      readable: Boolean(parsed.readable),
      merchant: parsed.merchant ?? null,
      date: parsed.date ?? null,
      currency: parsed.currency ?? null,
      total:
        typeof parsed.total === "number" ? parsed.total : null,
      category: parsed.category ?? null,
    };
  } catch (err) {
    console.error("extractReceiptData: failed to read/parse", filePath, err);
    return unreadable;
  }
}

function monthLabel(year: number, month: number): string {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleString("en-US", { month: "long", year: "numeric" });
}

/*
 * Build the monthly report for {year}-{month} (month is 1-12).
 * Scans every receipt across every conversation, reads each one with
 * the AI model, filters to the target month by the date printed on
 * the receipt (not file dates), and writes a 3-tab Excel workbook to
 * {uploadsRoot}/reports/Receipts-Report-<Month>-<Year>.xlsx
 */
export async function buildMonthlyReport(
  uploadsRoot: string,
  year: number,
  month: number
): Promise<{
  filePath: string;
  monthLabel: string;
  totalCount: number;
  needsReviewCount: number;
}> {
  const label = monthLabel(year, month);

  const allFiles = await listAllReceiptFiles(uploadsRoot);

  const records: ReceiptRecord[] = [];

  for (const file of allFiles) {
    const extracted = await extractReceiptData(file.filePath);

    records.push({
      filePath: file.filePath,
      filename: file.filename,
      conversationNumber: file.conversationNumber,
      ...extracted,
    });
  }

  const inMonth = records.filter((r) => {
    if (!r.readable || !r.date) return false;
    const [y, m] = r.date.split("-").map(Number);
    return y === year && m === month;
  });

  const needsReview = records.filter(
    (r) => !r.readable || !r.date
  );

  const workbook = new ExcelJS.Workbook();

  // ---- Summary tab ----
  const summarySheet = workbook.addWorksheet("Summary");

  const totalSpend = inMonth.reduce(
    (sum, r) => sum + (r.total ?? 0),
    0
  );

  const byMerchant = new Map<string, number>();
  const byCategory = new Map<string, number>();

  for (const r of inMonth) {
    const merchant = r.merchant ?? "Unknown";
    const category = r.category ?? "Uncategorized";
    byMerchant.set(merchant, (byMerchant.get(merchant) ?? 0) + (r.total ?? 0));
    byCategory.set(category, (byCategory.get(category) ?? 0) + (r.total ?? 0));
  }

  summarySheet.addRow([`Receipts Report — ${label}`]);
  summarySheet.addRow([]);
  summarySheet.addRow(["Total receipts", inMonth.length]);
  summarySheet.addRow(["Total spend", totalSpend.toFixed(2)]);
  summarySheet.addRow([]);
  summarySheet.addRow(["Spend by merchant"]);
  summarySheet.addRow(["Merchant", "Total"]);
  for (const [merchant, total] of [...byMerchant.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    summarySheet.addRow([merchant, total.toFixed(2)]);
  }
  summarySheet.addRow([]);
  summarySheet.addRow(["Spend by category"]);
  summarySheet.addRow(["Category", "Total"]);
  for (const [category, total] of [...byCategory.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    summarySheet.addRow([category, total.toFixed(2)]);
  }

  // ---- Itemized tab ----
  const itemizedSheet = workbook.addWorksheet("Itemized");
  itemizedSheet.addRow([
    "Date",
    "Merchant",
    "Category",
    "Currency",
    "Total",
    "Conversation",
    "Source file",
  ]);
  for (const r of inMonth.sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? "")
  )) {
    itemizedSheet.addRow([
      r.date,
      r.merchant,
      r.category,
      r.currency,
      r.total,
      r.conversationNumber,
      r.filename,
    ]);
  }

  // ---- Needs Review tab ----
  const reviewSheet = workbook.addWorksheet("Needs Review");
  reviewSheet.addRow(["Conversation", "Source file", "Reason"]);
  for (const r of needsReview) {
    reviewSheet.addRow([
      r.conversationNumber,
      r.filename,
      !r.readable ? "Could not read file" : "No purchase date detected",
    ]);
  }

  const reportsDir = path.join(uploadsRoot, "reports");
  await fs.mkdir(reportsDir, { recursive: true });

  const safeLabel = label.replace(" ", "-");
  const outPath = path.join(
    reportsDir,
    `Receipts-Report-${safeLabel}.xlsx`
  );

  await workbook.xlsx.writeFile(outPath);

  return {
    filePath: outPath,
    monthLabel: label,
    totalCount: inMonth.length,
    needsReviewCount: needsReview.length,
  };
}
