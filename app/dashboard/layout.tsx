"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, BookOpen, LogOut, Settings } from "lucide-react";
import { createClient } from "../../lib/supabase-client";
import { useRouter } from "next/navigation";

const navLinks = [
  { href: "/dashboard", icon: MessageSquare, label: "Bandeja de Entrada", short: "Bandeja" },
  { href: "/dashboard/knowledge", icon: BookOpen, label: "Entrenamiento Ava", short: "Ava" },
  { href: "/dashboard/settings", icon: Settings, label: "Configuración", short: "Config" },
];

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
      {/* Sidebar — desktop & tablet */}
      <div className="crm-sidebar">
        <div className="crm-sidebar-header">
          <div className="crm-sidebar-logo-icon">G</div>
          <span className="crm-sidebar-logo">Greenland CRM</span>
        </div>

        <nav className="crm-sidebar-nav">
          {navLinks.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              className={`crm-nav-link ${pathname === href ? "crm-active" : ""}`}
            >
              <Icon size={20} />
              <span className="crm-nav-label">{label}</span>
            </Link>
          ))}
        </nav>

        <div className="crm-sidebar-footer">
          <button onClick={handleLogout} className="crm-logout-btn">
            <LogOut size={18} />
            <span className="crm-nav-label">Cerrar Sesión</span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="crm-main">
        {children}
      </div>

      {/* Mobile bottom navigation */}
      <nav className="crm-mobile-nav">
        {navLinks.map(({ href, icon: Icon, short }) => (
          <Link
            key={href}
            href={href}
            className={`crm-mobile-nav-item ${pathname === href ? "crm-active" : ""}`}
          >
            <Icon size={22} />
            <span>{short}</span>
          </Link>
        ))}
        <button onClick={handleLogout} className="crm-mobile-nav-item">
          <LogOut size={22} />
          <span>Salir</span>
        </button>
      </nav>
    </div>
  );
}
