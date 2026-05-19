"use client";

import { createClient } from "../../lib/supabase-client";
import { useState } from "react";
import { LogIn, Mail } from "lucide-react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const supabase = createClient();
  const router = useRouter();

  const handleGoogleLogin = async () => {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
      background: "linear-gradient(135deg, #eef4f0 0%, #e0ede6 100%)",
      padding: "1.25rem",
    }}>
      <div style={{
        maxWidth: "400px",
        width: "100%",
        background: "white",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 8px 40px rgba(27, 67, 50, 0.12), 0 2px 8px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}>
        {/* Top accent bar */}
        <div style={{
          height: "4px",
          background: "linear-gradient(90deg, var(--primary-dark), var(--primary-light))",
        }} />

        <div style={{ padding: "2.25rem 2rem 2rem" }}>
          {/* Brand mark */}
          <div style={{ textAlign: "center", marginBottom: "1.75rem" }}>
            <div style={{
              width: 52,
              height: 52,
              background: "linear-gradient(135deg, var(--primary-dark), var(--primary))",
              borderRadius: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1rem",
              boxShadow: "0 4px 14px rgba(45, 106, 79, 0.30)",
            }}>
              <span style={{ color: "white", fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.02em" }}>G</span>
            </div>
            <h1 style={{ fontSize: "1.375rem", margin: "0 0 0.375rem" }}>Greenland Deco CRM</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", margin: 0 }}>
              Inicia sesión para acceder a tu panel
            </p>
          </div>

          {errorMsg && (
            <div style={{
              background: "#fef2f2",
              color: "#991b1b",
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius-sm)",
              marginBottom: "1.25rem",
              fontSize: "0.875rem",
              border: "1px solid #fecaca",
            }}>
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.25rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.8375rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                required
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.8375rem", fontWeight: 600, color: "var(--text-secondary)" }}>
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", padding: "0.8125rem", marginTop: "0.25rem", fontSize: "0.9375rem" }}
            >
              <Mail size={17} />
              {loading ? "Iniciando sesión..." : "Entrar con correo"}
            </button>
          </form>

          <div style={{ position: "relative", marginBottom: "1.25rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--border-color)" }} />
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", whiteSpace: "nowrap" }}>o continúa con</span>
            <div style={{ flex: 1, height: "1px", background: "var(--border-color)" }} />
          </div>

          <button
            onClick={handleGoogleLogin}
            type="button"
            disabled={loading}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.625rem",
              padding: "0.8125rem",
              background: "white",
              color: "#374151",
              border: "1.5px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              fontWeight: 500,
              fontSize: "0.9375rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            }}
          >
            <LogIn size={17} />
            Iniciar sesión con Google
          </button>
        </div>
      </div>
    </div>
  );
}
