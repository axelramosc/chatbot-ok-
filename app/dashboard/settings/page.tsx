"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase-client";
import { BuildingStorefrontIcon, CubeIcon, PlusIcon } from "@heroicons/react/24/outline";
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
  const [activeTab, setActiveTab] = useState<"business" | "catalog">("business");
  const [businessSettings, setBusinessSettings] = useState<Record<string, string>>({});
  const [loadingBusiness, setLoadingBusiness] = useState(true);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [savingCatalog, setSavingCatalog] = useState<string | null>(null);
  const toast = useToast();
  const supabase = createClient();

  useEffect(() => {
    if (activeTab === "business") fetchBusinessSettings();
    else fetchCatalog();
  }, [activeTab]);

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

  const fetchCatalog = async () => {
    setLoadingCatalog(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setProducts(data);
    setLoadingCatalog(false);
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

  const handleProductChange = (id: string, field: string, value: any) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const saveProduct = async (product: any) => {
    setSavingCatalog(product.id);
    const { id, created_at, updated_at, ...updateData } = product;

    let error;
    if (id.startsWith("new-")) {
      ({ error } = await supabase.from("products").insert(updateData));
    } else {
      ({ error } = await supabase
        .from("products")
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq("id", id));
    }

    if (error) {
      toast("Error al guardar el producto.", "error");
    } else {
      toast("Producto guardado.", "success");
      await fetchCatalog();
    }
    setSavingCatalog(null);
  };

  const addProductRow = () => {
    const newProduct = {
      id: `new-${Date.now()}`,
      name: "",
      price: 0,
      unit: "pieza",
      availability: "disponible",
      is_active: true,
      price_per_box: null,
      pieces_per_box: null,
      coverage_per_piece: null,
      description: "",
      restock_date: "",
    };
    setProducts([newProduct, ...products]);
  };

  return (
    <div style={{ padding: "2rem", overflowY: "auto", height: "100%" }}>
      <div>
        <h2 style={{ fontSize: "1.5rem", margin: "0 0 1.5rem 0" }}>Configuración del Sistema</h2>

        <div className="crm-tabs">
          <button
            onClick={() => setActiveTab("business")}
            className={`crm-tab-btn ${activeTab === "business" ? "crm-tab-active" : "crm-tab-inactive"}`}
          >
            <BuildingStorefrontIcon style={{ width: "17px" }} />
            Datos del Negocio
          </button>
          <button
            onClick={() => setActiveTab("catalog")}
            className={`crm-tab-btn ${activeTab === "catalog" ? "crm-tab-active" : "crm-tab-inactive"}`}
          >
            <CubeIcon style={{ width: "17px" }} />
            Catálogo de Productos
          </button>
        </div>
      </div>

      {activeTab === "business" && (
        <div style={{ maxWidth: "800px" }}>
          <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>
            Esta información es utilizada por Ava para responder preguntas sobre la tienda, ubicación, horarios y políticas.
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
      )}

      {activeTab === "catalog" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>
              Gestiona los productos, precios y disponibilidad. Ava usará estos datos exactos para cotizar.
            </p>
            <button
              onClick={addProductRow}
              style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "var(--primary)", color: "white" }}
            >
              <PlusIcon style={{ width: "18px" }} />
              Nuevo Producto
            </button>
          </div>

          {loadingCatalog ? <p>Cargando catálogo...</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
              {products.map((product) => (
                <div
                  key={product.id}
                  style={{
                    background: "white",
                    border: "1px solid var(--border-color)",
                    borderRadius: "12px",
                    padding: "1.5rem",
                    boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
                  }}
                >
                  <div className="crm-catalog-row-top">
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Nombre</label>
                      <input
                        type="text"
                        value={product.name || ""}
                        onChange={(e) => handleProductChange(product.id, "name", e.target.value)}
                        style={{ width: "100%", fontWeight: "bold" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Disponibilidad</label>
                      <select
                        value={product.availability || "disponible"}
                        onChange={(e) => handleProductChange(product.id, "availability", e.target.value)}
                        style={{ width: "100%", padding: "0.6rem", borderRadius: "8px", border: "1px solid var(--border-color)" }}
                      >
                        <option value="disponible">Disponible</option>
                        <option value="agotado">Agotado</option>
                        <option value="próximamente">Próximamente</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Fecha Resurtido (opcional)</label>
                      <input
                        type="text"
                        value={product.restock_date || ""}
                        placeholder="ej. Junio 2026"
                        onChange={(e) => handleProductChange(product.id, "restock_date", e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>

                  <div className="crm-catalog-row-pricing">
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Unidad</label>
                      <input
                        type="text"
                        value={product.unit || "pieza"}
                        onChange={(e) => handleProductChange(product.id, "unit", e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Precio Base ($)</label>
                      <input
                        type="number"
                        value={product.price || 0}
                        onChange={(e) => handleProductChange(product.id, "price", parseFloat(e.target.value))}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Piezas x Caja</label>
                      <input
                        type="number"
                        value={product.pieces_per_box || ""}
                        onChange={(e) => handleProductChange(product.id, "pieces_per_box", e.target.value ? parseInt(e.target.value) : null)}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Precio x Caja ($)</label>
                      <input
                        type="number"
                        value={product.price_per_box || ""}
                        onChange={(e) => handleProductChange(product.id, "price_per_box", e.target.value ? parseFloat(e.target.value) : null)}
                        style={{ width: "100%" }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Cobertura/Pza (m²)</label>
                      <input
                        type="number"
                        step="0.001"
                        value={product.coverage_per_piece || ""}
                        onChange={(e) => handleProductChange(product.id, "coverage_per_piece", e.target.value ? parseFloat(e.target.value) : null)}
                        style={{ width: "100%" }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: "1rem" }}>
                    <label style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Descripción (Opcional)</label>
                    <textarea
                      value={product.description || ""}
                      onChange={(e) => handleProductChange(product.id, "description", e.target.value)}
                      style={{ width: "100%", minHeight: "60px", padding: "0.75rem", border: "1px solid var(--border-color)", borderRadius: "8px" }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      onClick={() => saveProduct(product)}
                      disabled={savingCatalog === product.id}
                      style={{ background: "var(--primary)", color: "white" }}
                    >
                      {savingCatalog === product.id ? "Guardando..." : "Guardar Producto"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
