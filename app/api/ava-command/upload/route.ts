import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reutiliza el bucket público existente de imágenes de producto. Las imágenes ad-hoc
// del comando /ava se guardan bajo el prefijo `ava-adhoc/` para distinguirlas.
const BUCKET = "product-images";
const PREFIX = "ava-adhoc";
const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — dentro del límite de body de Vercel y de WhatsApp (5 MB).
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function sanitizeFilename(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80) || "image";
}

function extensionFor(mime: string, fallback: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return fallback || ".bin";
}

export async function POST(request: Request) {
  // Auth: solo admin con sesión válida.
  const cookieStore = await cookies();
  const sessionClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(_n: string, _v: string, _o: CookieOptions) {},
        remove(_n: string, _o: CookieOptions) {},
      },
    },
  );
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    return NextResponse.json({ error: "invalid_form_data", detail: String(err) }, { status: 400 });
  }

  const file = form.get("file");
  const conversationId = form.get("conversationId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const mime = file.type;
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: "unsupported_mime", detail: `Solo se aceptan JPEG, PNG y WEBP. Recibido: ${mime || "desconocido"}.` },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "empty_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", detail: `Máximo ${Math.floor(MAX_BYTES / 1024 / 1024)} MB. Recibido: ${(file.size / 1024 / 1024).toFixed(2)} MB.` },
      { status: 400 },
    );
  }

  const supabase = getSupabase();

  const originalName = sanitizeFilename(file.name || "image");
  const ext = extensionFor(mime, originalName.includes(".") ? "." + originalName.split(".").pop() : "");
  const base = originalName.replace(/\.[^.]+$/, "");
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const convScope = typeof conversationId === "string" && UUID_RE.test(conversationId) ? conversationId : "general";
  const path = `${PREFIX}/${convScope}/${Date.now()}-${base}${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase
    .storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mime,
      cacheControl: "31536000", // 1 año — el path incluye timestamp, así que es seguro cachear fuerte.
      upsert: false,
    });

  if (uploadError) {
    console.error("ava-command/upload storage error:", uploadError);
    return NextResponse.json({ error: "upload_failed" }, { status: 500 });
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const imageUrl = publicUrlData?.publicUrl;
  if (!imageUrl) {
    return NextResponse.json({ error: "public_url_failed" }, { status: 500 });
  }

  return NextResponse.json({ imageUrl });
}
