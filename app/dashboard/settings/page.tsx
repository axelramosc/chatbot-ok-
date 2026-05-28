"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase-client";
import { BuildingStorefrontIcon } from "@heroicons/react/24/outline";
import { useToast } from "../../components/toast";

// Human-readable labels for every known business settings key
const SETTING_LABELS: Record<string, { label: string; hint?: string; multiline?: boolean }> = {
  name:                 { label: "Nombre del Negocio" },
  address:              { label: "Dirección" },
  phone_1:              { label: "Teléfono Principal" },
  phone_2:              { label: "Teléfono Secundario" },
  hours:                { label: "Horario de Atención", multiline: true },
  payment_methods:      { label: "Métodos de Pago Aceptados", multiline: true },
  website:              { label: "Sitio Web" },
  instagram:            { label: "Instagram" },
  facebook:             { label: "Facebook" },
  extra_info:           { label: "Información Adicional", multiline: true },
  sales_agent_numbers:  { label: "Teléfonos de Asesores", hint: "Separados por coma. Ej: 528441757500, 528441757501", multiline: true },
};

function getLabel(key: string) {
  return SETTING_LABELS[key]?.label ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isMultiline(key: string, value: string) {
  return SETTING_LABELS[key]?.multiline || value.length > 60;
}

export default function SettingsPage() {
  const [businessSettings, setBusinessSettings] = useState<Record<string, string>>({});
  const [loadingBusiness, setLoadingBusiness] = useState(true);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const toast = useToast();
  const supabase = createClient();

  useEffect(() => {
    fetchBusinessSettings();
  }, []);

  const fetchBusinessSettings = async () => {
    setLoadingBusiness(true);
    const { data } = await supabase.from("business_settings").select("*");
    if (data) {
      const settingsMap = data.reduce(
        (acc, row) => ({ ...acc, [row.key]: row.value }),
        {} as Record<string, string>
      );
      if (!settingsMap["sales_agent_numbers"]) {
        settingsMap["sales_agent_numbers"] = "";
      }
      setBusinessSettings(settingsMap);
    }
    setLoadingBusiness(false);
  };

  const handleBusinessChange = (key: string, value: string) => {
    setBusinessSettings((prev) => ({ ...prev, [key]: value }));
  };

  const saveBusinessSettings = async () => {
    setSavingBusiness(true);
    const updates = Object.entries(businessSettings).map(([key, value]) => ({
      key,
      value,
      updated_at: new Date().toISOString(),
    }));

    let hasError = false;
    for (const update of updates) {
      const { error } = await supabase
        .from("business_settings")
        .upsert(update, { onConflict: "key" });
      if (error) hasError = true;
    }

    setSavingBusiness(false);
    if (hasError) {
      toast("Hubo un error al guardar algunos campos.", "error");
    } else {
      toast("Configuración guardada exitosamente.", "success");
    }
  };

  return (
    <div style={{ padding: "2rem", overflowY: "auto", height: "100%" }}>
      <div>
        <h2 style={{ fontSize: "1.5rem", margin: "0 0 1.5rem 0" }}>Configuración del Sistema</h2>

        <div className="crm-tabs">
          <button className="crm-tab-btn crm-tab-active">
            <BuildingStorefrontIcon style={{ width: "17px" }} />
            Datos del Negocio
          </button>
        </div>
      </div>

      <div style={{ maxWidth: "800px" }}>
        <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>
          Esta información es utilizada por Ava para responder preguntas sobre la tienda, ubicación, horarios y políticas. El catálogo de productos se gestiona desde <strong>Entrenamiento de Ava</strong>.
        </p>

        {loadingBusiness ? <p>Cargando...</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {Object.entries(businessSettings).map(([key, value]) => {
              const meta = SETTING_LABELS[key];
              return (
                <div key={key}>
                  <label style={{ display: "block", marginBottom: "0.25rem", fontWeight: 600 }}>
                    {getLabel(key)}
                  </label>
                  {meta?.hint && (
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: "0 0 0.4rem 0" }}>
                      {meta.hint}
                    </p>
                  )}
                  {isMultiline(key, value) ? (
                    <textarea
                      value={value}
                      onChange={(e) => handleBusinessChange(key, e.target.value)}
                      style={{ width: "100%", padding: "0.75rem", border: "1px solid var(--border-color)", borderRadius: "8px", minHeight: "80px" }}
                    />
                  ) : (
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => handleBusinessChange(key, e.target.value)}
                      style={{ width: "100%", padding: "0.75rem", border: "1px solid var(--border-color)", borderRadius: "8px" }}
                    />
                  )}
                </div>
              );
            })}

            <div style={{ marginTop: "1rem" }}>
              <button
                onClick={saveBusinessSettings}
                disabled={savingBusiness}
                style={{ background: "var(--primary)", color: "white", padding: "0.75rem 2rem" }}
              >
                {savingBusiness ? "Guardando..." : "Guardar Cambios"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
