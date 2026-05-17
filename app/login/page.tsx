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
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setErrorMsg(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div className="flex justify-center items-center h-screen bg-gray-50">
      <div style={{ maxWidth: "400px", width: "100%", padding: "2rem", background: "white", borderRadius: "8px", boxShadow: "0 4px 6px rgba(0,0,0,0.1)", textAlign: "center" }}>
        <h1 style={{ marginBottom: "1rem" }}>Greenland Deco CRM</h1>
        <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>
          Inicia sesión para acceder a la bandeja de entrada y conocimiento de Ava.
        </p>

        {errorMsg && (
          <div style={{ background: "#f8d7da", color: "#721c24", padding: "0.5rem", borderRadius: "4px", marginBottom: "1rem", fontSize: "0.9rem" }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem", textAlign: "left" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", fontWeight: "bold" }}>Correo Electrónico</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
              required
            />
          </div>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.9rem", fontWeight: "bold" }}>Contraseña</label>
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
            style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", padding: "0.75rem", marginTop: "0.5rem" }}
          >
            <Mail size={18} />
            {loading ? "Iniciando..." : "Entrar con Correo"}
          </button>
        </form>

        <div style={{ position: "relative", marginBottom: "1.5rem" }}>
          <hr style={{ borderTop: "1px solid var(--border-color)", margin: "0" }} />
          <span style={{ position: "absolute", top: "-10px", left: "50%", transform: "translateX(-50%)", background: "white", padding: "0 10px", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            ó
          </span>
        </div>

        <button 
          onClick={handleGoogleLogin} 
          type="button"
          disabled={loading}
          style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem", padding: "0.75rem", background: "white", color: "#333", border: "1px solid var(--border-color)" }}
        >
          <LogIn size={18} />
          Iniciar sesión con Google
        </button>
      </div>
    </div>
  );
}
