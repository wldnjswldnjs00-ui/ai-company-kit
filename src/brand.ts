import type { SupabaseClient } from "@supabase/supabase-js";

// The company's own look: a logo for light backgrounds, one for dark
// backgrounds, a square home-screen icon, and a black or white side menu.
// Images are uploaded on the setup screen and kept in the settings table
// under "brand:<kind>" (as data URLs), so nothing needs Cloudflare or a
// file store. The small "brand" setting records which exist and when they
// changed, so pages can link them with a cache-busting version.

export const BRAND_KINDS = ["logoLight", "logoDark", "icon"] as const;
export type BrandKind = (typeof BRAND_KINDS)[number];
export type SideTheme = "black" | "white";
export type Brand = { versions: Partial<Record<BrandKind, number>>; theme: SideTheme };

export const MAX_BRAND_BYTES = 300_000;
export const BRAND_ROW_PREFIX = "brand:";

let brand: Brand = { versions: {}, theme: "black" };

export function setBrand(next: Brand): void {
  brand = next;
}

export function currentBrand(): Brand {
  return brand;
}

export function parseBrand(versionsJson: string | undefined, theme: string | undefined): Brand {
  let versions: Brand["versions"] = {};
  try {
    const parsed = JSON.parse(versionsJson ?? "{}") as Record<string, unknown>;
    for (const k of BRAND_KINDS) if (typeof parsed[k] === "number") versions[k] = parsed[k] as number;
  } catch {
    versions = {};
  }
  return { versions, theme: theme === "white" ? "white" : "black" };
}

export function brandUrl(kind: BrandKind, b: Brand = brand): string | undefined {
  const v = b.versions[kind];
  return v ? `/brand/${kind}?v=${v}` : undefined;
}

// Only real PNG, JPEG or WebP files (checked by their first bytes, not the
// name). SVG is refused: it can carry scripts.
export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function toDataUrl(bytes: Uint8Array): { ok: true; dataUrl: string } | { ok: false; message: string } {
  if (bytes.length > MAX_BRAND_BYTES) return { ok: false, message: `이미지가 너무 큽니다(${Math.round(bytes.length / 1000)}KB). 300KB 이하로 줄여서 올려 주세요.` };
  const type = sniffImage(bytes);
  if (!type) return { ok: false, message: "PNG, JPG, WebP 이미지만 올릴 수 있습니다." };
  return { ok: true, dataUrl: `data:${type};base64,${toBase64(bytes)}` };
}

export function fromDataUrl(dataUrl: string): { type: string; bytes: Uint8Array } | null {
  const m = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!m) return null;
  return { type: m[1], bytes: Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) };
}

export async function loadBrandImage(client: SupabaseClient, kind: BrandKind): Promise<string | null> {
  const { data } = await client.from("settings").select("value").eq("key", `${BRAND_ROW_PREFIX}${kind}`).maybeSingle();
  return (data as { value: string } | null)?.value ?? null;
}
