import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

// Store settings next to the project root — persists across Electron relaunches
const SETTINGS_FILE = path.join(process.cwd(), ".thumbgen-settings.json");

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET() {
  const data = await readSettings();
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Merge with existing settings so partial updates don't erase fields
    const existing = await readSettings();
    const merged = { ...existing, ...body };

    await fs.writeFile(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to save settings:", err);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
