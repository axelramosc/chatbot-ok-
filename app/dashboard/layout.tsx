"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, BookOpen, LogOut } from "lucide-react";
import { createClient } from "../../lib/supabase-client";
import { useRouter } from "next/navigation";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div style={{ width: "250px", borderRight: "1px solid var(--border-color)", background: "white", display: "flex", flexDirection: "column" }}>
        <div className="p-4" style={{ borderBottom: "1px solid var(--border-color)" }}>
          <h2 style={{ fontSize: "1.2rem", margin: 0 }}>Greenland CRM</h2>
        </div>
        
        <nav style={{ flex: 1, padding: "1rem 0" }}>
          <Link 
            href="/dashboard" 
            style={{ 
              display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1.5rem",
              background: pathname === "/dashboard" ? "rgba(45, 106, 79, 0.1)" : "transparent",
              color: pathname === "/dashboard" ? "var(--primary)" : "var(--text-color)",
              fontWeight: pathname === "/dashboard" ? "600" : "400"
            }}
          >
            <MessageSquare size={20} />
            Bandeja de Entrada
          </Link>
          <Link 
            href="/dashboard/knowledge" 
            style={{ 
              display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1.5rem",
              background: pathname === "/dashboard/knowledge" ? "rgba(45, 106, 79, 0.1)" : "transparent",
              color: pathname === "/dashboard/knowledge" ? "var(--primary)" : "var(--text-color)",
              fontWeight: pathname === "/dashboard/knowledge" ? "600" : "400"
            }}
          >
            <BookOpen size={20} />
            Entrenamiento Ava
          </Link>
        </nav>

        <div className="p-4" style={{ borderTop: "1px solid var(--border-color)" }}>
          <button 
            onClick={handleLogout}
            style={{ background: "transparent", color: "var(--text-muted)", width: "100%", display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <LogOut size={18} />
            Cerrar Sesión
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {children}
      </div>
    </div>
  );
}
