// Broj punih pakovanja se izvodi iz količine; poziva se posle svake promene stanja.
export interface PackagedStock {
  quantity?: number | null;
  familyQuantity?: number | null;
  unitsPerPackage?: number | null;
  packageCount?: number | null;
  familyPackageCount?: number | null;
}

export function recalcPackages(doc: PackagedStock): void {
  const u = doc.unitsPerPackage || 0;
  doc.packageCount = u > 0 ? Math.floor((doc.quantity || 0) / u) : 0;
  if ("familyQuantity" in doc || doc.familyPackageCount !== undefined) {
    doc.familyPackageCount = u > 0 ? Math.floor((doc.familyQuantity || 0) / u) : 0;
  }
}
