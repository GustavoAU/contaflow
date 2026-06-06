import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ContaFlow",
    short_name: "ContaFlow",
    description: "Sistema contable profesional venezolano",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#18181b",
    categories: ["finance", "business"],
    lang: "es-VE",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/dashboard-ejecutivo.jpg",
        type: "image/jpeg",
        form_factor: "wide",
        label: "Dashboard Ejecutivo",
      },
      {
        src: "/screenshots/libro-iva.jpg",
        type: "image/jpeg",
        form_factor: "wide",
        label: "Libro de IVA",
      },
      {
        src: "/screenshots/estado-resultados.jpg",
        type: "image/jpeg",
        form_factor: "wide",
        label: "Estado de Resultados",
      },
    ],
  };
}
