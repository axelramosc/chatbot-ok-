import { NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabase } from "../../../../lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "product-images";
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

  const productId = form.get("productId");
  const file = form.get("file");

  if (typeof productId !== "string" || !productId.trim()) {
    return NextResponse.json({ error: "missing_product_id" }, { status: 400 });
  }
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

  // Verifica que el producto existe (evita subir basura si el cliente manda un UUID inválido).
  const { data: product, error: lookupError } = await supabase
    .from("products")
    .select("id, image_url")
    .eq("id", productId)
    .maybeSingle();

  if (lookupError) {
    console.error("upload-image lookup error:", lookupError);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  const originalName = sanitizeFilename(file.name || "image");
  const ext = extensionFor(mime, originalName.includes(".") ? "." + originalName.split(".").pop() : "");
  const base = originalName.replace(/\.[^.]+$/, "");
  const path = `${productId}/${Date.now()}-${base}${ext}`;

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
    console.error("upload-image storage error:", uploadError);
    return NextResponse.json(
      { error: "upload_failed", detail: uploadError.message },
      { status: 500 },
    );
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const imageUrl = publicUrlData?.publicUrl;
  if (!imageUrl) {
    return NextResponse.json({ error: "public_url_failed" }, { status: 500 });
  }

  const { error: updateError } = await supabase
    .from("products")
    .update({ image_url: imageUrl, updated_at: new Date().toISOString() })
    .eq("id", productId);

  if (updateError) {
    console.error("upload-image db update error:", updateError);
    // Imagen subida pero DB no actualizada — devolvemos error claro.
    return NextResponse.json(
      { error: "db_update_failed", detail: updateError.message, imageUrl },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, imageUrl, path });
}

export async function DELETE(request: Request) {
  // Auth: solo admin.
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

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "missing_product_id" }, { status: 400 });
  }

  const supabase = getSupabase();

  const { data: product } = await supabase
    .from("products")
    .select("id, image_url")
    .eq("id", productId)
    .maybeSingle();

  if (!product) {
    return NextResponse.json({ error: "product_not_found" }, { status: 404 });
  }

  // Intenta borrar el blob solo si la URL apunta a nuestro bucket; ignora errores
  // (puede ser que el archivo ya no exista o que la URL sea externa).
  if (product.image_url && product.image_url.includes(`/${BUCKET}/`)) {
    const marker = `/${BUCKET}/`;
    const idx = product.image_url.indexOf(marker);
    if (idx >= 0) {
      const path = product.image_url.slice(idx + marker.length).split("?")[0];
      await supabase.storage.from(BUCKET).remove([path]).catch((e) => {
        console.warn("upload-image delete (non-fatal):", e);
      });
    }
  }

  const { error } = await supabase
    .from("products")
    .update({ image_url: null, updated_at: new Date().toISOString() })
    .eq("id", productId);

  if (error) {
    return NextResponse.json({ error: "db_update_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
