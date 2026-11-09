// Adrese frontenda kojima API veruje (CORS i provera porekla zahteva sa kolačićem)
export const allowedOrigins = () =>
  (process.env.CORS_ORIGIN || "https://medikalija-frontend.vercel.app")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
