import type { Types } from "mongoose";

// Oblici referenci posle `.populate(...)`, za `populate<{ polje: Tip }>()`.
export interface UserRef {
  _id: Types.ObjectId;
  name: string;
  lastName: string;
  role: string;
}

export interface PatientRef {
  _id: Types.ObjectId;
  name: string;
  lastName: string;
}

export interface NamedRef {
  _id: Types.ObjectId;
  name: string;
}

export interface PricedRef extends NamedRef {
  price: number;
}

export interface StockRef extends NamedRef {
  unitsPerPackage?: number | null;
  pricePerUnit?: number | null;
  price?: number | null;
}
