// Dozvoljava pristup samo navedenim ulogama. Koristi se posle authMiddleware.
export const MANAGER_ROLES = ["admin", "main-nurse"];

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: "Nemate dozvolu za ovu radnju." });
  }
  next();
};

export const requireManager = requireRole(...MANAGER_ROLES);

// Dodavanje na stanje: porodične zalihe (fromFamily) unose sve uloge osoblja,
// a stanje doma i cene menja samo uprava.
export const requireManagerUnlessFamily = (req, res, next) =>
  req.body?.fromFamily ? next() : requireManager(req, res, next);
