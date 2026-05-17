import "./globals.css";

export const metadata = {
  title: "Greenland Deco - CRM",
  description: "Bandeja de entrada y CRM para Greenland Deco",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
