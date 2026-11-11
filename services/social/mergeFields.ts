// Polja za Word šablone: jedan katalog (naziv polja, opis, grupa) i jedno mesto gde se
// popunjavaju iz podataka korisnika. Podatak unet jednom (npr. JMBG, staratelj) pojavljuje se
// u svakom šablonu koji koristi to polje. Nazivi su bez kvačica da se lako kucaju u Wordu.
import Patient from "../../models/Patient.js";
import SocialProfile from "../../models/SocialProfile.js";
import SocialDocument from "../../models/SocialDocument.js";
import GlobalSetting, { DEFAULT_FACILITY } from "../../models/GlobalSetting.js";
import { normalizeStoredDay } from "../../utils/dateUtils.js";

export interface MergeFieldDef {
  key: string;
  label: string;
  group: string;
}
export interface MergeListDef {
  key: string;
  label: string;
  fields: MergeFieldDef[];
}

const F = (group: string, key: string, label: string): MergeFieldDef => ({ key, label, group });

export const MERGE_FIELDS: MergeFieldDef[] = [
  F("Korisnik", "ime", "Ime"),
  F("Korisnik", "prezime", "Prezime"),
  F("Korisnik", "ime_prezime", "Ime i prezime"),
  F("Korisnik", "jmbg", "JMBG"),
  F("Korisnik", "datum_rodjenja", "Datum rođenja"),
  F("Korisnik", "godine", "Broj godina"),
  F("Korisnik", "mesto_rodjenja", "Mesto rođenja"),
  F("Korisnik", "ime_roditelja", "Ime jednog roditelja"),
  F("Korisnik", "pol", "Pol"),
  F("Korisnik", "adresa", "Adresa prebivališta"),
  F("Korisnik", "opstina", "Opština prebivališta"),
  F("Korisnik", "drzavljanstvo", "Državljanstvo"),
  F("Korisnik", "bracni_status", "Bračni status"),
  F("Korisnik", "obrazovanje", "Obrazovanje"),
  F("Korisnik", "zanimanje", "Zanimanje"),
  F("Korisnik", "broj_licne_karte", "Broj lične karte"),
  F("Korisnik", "lbo", "LBO / broj zdravstvene kartice"),
  F("Korisnik", "izabrani_lekar", "Izabrani lekar"),
  F("Smeštaj", "datum_prijema", "Datum prijema"),
  F("Smeštaj", "osnov_smestaja", "Osnov smeštaja"),
  F("Smeštaj", "broj_ugovora", "Broj ugovora"),
  F("Smeštaj", "datum_ugovora", "Datum ugovora"),
  F("Smeštaj", "csr", "Centar za socijalni rad"),
  F("Smeštaj", "voditelj_slucaja", "Voditelj slučaja"),
  F("Smeštaj", "broj_resenja_csr", "Broj rešenja CSR-a"),
  F("Smeštaj", "datum_resenja_csr", "Datum rešenja CSR-a"),
  F("Smeštaj", "penzija", "Vrsta penzije"),
  F("Smeštaj", "placa_smestaj", "Ko plaća smeštaj"),
  F("Smeštaj", "stepen_podrske", "Stepen podrške"),
  F("Smeštaj", "zaduzeni_zaposleni", "Zaduženi zaposleni"),
  F("Pravni status", "poslovna_sposobnost", "Poslovna sposobnost"),
  F("Pravni status", "staratelj", "Staratelj (ime i prezime)"),
  F("Pravni status", "staratelj_srodstvo", "Odnos staratelja sa korisnikom"),
  F("Pravni status", "staratelj_telefon", "Telefon staratelja"),
  F("Pravni status", "resenje_o_starateljstvu", "Rešenje o starateljstvu (broj, datum, organ)"),
  F("Pravni status", "osoba_od_poverenja", "Osoba od poverenja"),
  F("Porodica", "kontakt_osoba", "Glavni kontakt (ime, srodstvo, telefon)"),
  F("Porodica", "hitni_kontakt", "Hitni kontakt"),
  F("Individualni plan", "datum_plana", "Datum poslednjeg individualnog plana"),
  F("Individualni plan", "rok_pregleda_plana", "Rok za ponovni pregled plana"),
  F("Ustanova", "ustanova", "Naziv ustanove"),
  F("Ustanova", "ustanova_adresa", "Adresa ustanove"),
  F("Ustanova", "ustanova_telefon", "Telefon ustanove"),
  F("Ustanova", "danas", "Današnji datum"),
];

/** Tabele: red u Wordu sa {#kontakti} … {/kontakti} ponavlja se za svaki kontakt */
export const MERGE_LISTS: MergeListDef[] = [
  {
    key: "kontakti",
    label: "Porodica i kontakti",
    fields: [F("", "kontakt_ime", "Ime i prezime"), F("", "kontakt_srodstvo", "Srodstvo"), F("", "kontakt_telefon", "Telefon"), F("", "kontakt_email", "E-pošta"), F("", "kontakt_adresa", "Adresa")],
  },
  {
    key: "ciljevi",
    label: "Ciljevi poslednjeg individualnog plana",
    fields: [
      F("", "rb", "Redni broj"),
      F("", "cilj", "Cilj"),
      F("", "ishod", "Očekivani ishod"),
      F("", "aktivnosti", "Aktivnosti"),
      F("", "odgovorni", "Odgovorno lice"),
      F("", "rok", "Rok"),
    ],
  },
];

const LABELS: Record<string, Record<string, string>> = {
  sex: { M: "muški", Ž: "ženski" },
  marital: { single: "neoženjen / neudata", married: "u braku", partnership: "vanbračna zajednica", divorced: "razveden / razvedena", widowed: "udovac / udovica" },
  legal: { full: "poslovno sposoban", partial: "delimično lišen poslovne sposobnosti", none: "potpuno lišen poslovne sposobnosti" },
  placement: { contract: "ugovor", csr: "rešenje centra za socijalni rad" },
  payer: { resident: "korisnik", family: "porodica", csr: "CSR / opština", mixed: "više platilaca", other: "drugo" },
  pension: { old_age: "starosna", family: "porodična", disability: "invalidska", foreign: "inostrana", none: "bez penzije", other: "drugo" },
  level: { "1": "I stepen", "2": "II stepen", "3": "III stepen", "4": "IV stepen" },
};

/** dd.mm.gggg. (kalendarski dan, nezavisno od zone) */
export const fmtDay = (v: Date | string | null | undefined) => {
  const d = normalizeStoredDay(v ?? null);
  if (!d) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}.`;
};

const ageOf = (birth: Date | null) => {
  if (!birth) return "";
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  if (now.getUTCMonth() < birth.getUTCMonth() || (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())) age -= 1;
  return String(age);
};

const join = (...parts: Array<string | null | undefined>) => parts.filter((p) => p && p.trim()).join(", ");

/** Svi podaci korisnika za šablone: polja (tekst) i tabele (nizovi redova). Prazno polje je "". */
export async function buildMergeData(patientId: string) {
  const [patient, profile, plan, settings] = await Promise.all([
    Patient.findById(patientId).lean(),
    SocialProfile.findOne({ patient: patientId }).populate<{ assignedStaff: { name: string; lastName: string } | null }>("assignedStaff", "name lastName").lean(),
    SocialDocument.findOne({ patient: patientId, type: { $in: ["plan", "plan_review"] }, status: "final" }).sort({ date: -1 }).lean(),
    GlobalSetting.findOne().lean(),
  ]);
  if (!patient) return null;
  const p = profile ?? ({} as Partial<NonNullable<typeof profile>>);
  const birth = normalizeStoredDay(patient.dateOfBirth ?? null);
  const contacts = p.contacts ?? [];
  const primary = contacts.find((c) => c.emergency) ?? contacts[0];
  const contactLine = (c?: { name: string; relation?: string; phone?: string }) => (c ? join(c.name, c.relation, c.phone) : "");
  const g = p.guardian;
  // Dok admin ne sačuva podešavanja ustanove, važe podrazumevani podaci (kao u zaglavlju aplikacije)
  const facility = settings?.facility ?? DEFAULT_FACILITY;

  const fields: Record<string, string> = {
    ime: patient.name,
    prezime: patient.lastName,
    ime_prezime: `${patient.name} ${patient.lastName}`,
    jmbg: p.jmbg ?? "",
    datum_rodjenja: fmtDay(birth),
    godine: ageOf(birth),
    mesto_rodjenja: p.birthPlace ?? "",
    ime_roditelja: p.parentName ?? "",
    pol: LABELS.sex![p.sex ?? ""] ?? "",
    adresa: patient.address ?? "",
    opstina: p.municipality ?? "",
    drzavljanstvo: p.citizenship ?? "",
    bracni_status: LABELS.marital![p.maritalStatus ?? ""] ?? "",
    obrazovanje: p.education ?? "",
    zanimanje: p.occupation ?? "",
    broj_licne_karte: p.idCardNumber ?? "",
    lbo: p.healthInsuranceNumber ?? "",
    izabrani_lekar: p.chosenDoctor ?? "",
    datum_prijema: fmtDay(patient.admissionDate),
    osnov_smestaja: LABELS.placement![p.placementBasis ?? ""] ?? "",
    broj_ugovora: p.contractNumber ?? "",
    datum_ugovora: fmtDay(p.contractDate),
    csr: p.csrName ?? "",
    voditelj_slucaja: p.caseManager ?? "",
    broj_resenja_csr: p.csrDecisionNumber ?? "",
    datum_resenja_csr: fmtDay(p.csrDecisionDate),
    penzija: LABELS.pension![p.pensionType ?? ""] ?? "",
    placa_smestaj: LABELS.payer![p.payer ?? ""] ?? "",
    stepen_podrske: LABELS.level![String(p.supportLevel ?? 0)] ?? "",
    zaduzeni_zaposleni: p.assignedStaff ? `${p.assignedStaff.name} ${p.assignedStaff.lastName}` : "",
    poslovna_sposobnost: LABELS.legal![p.legalCapacity ?? ""] ?? "",
    staratelj: g?.name ?? "",
    staratelj_srodstvo: g?.relation ?? "",
    staratelj_telefon: g?.phone ?? "",
    resenje_o_starateljstvu: g ? join(g.decisionNumber, fmtDay(g.decisionDate), g.authority) : "",
    osoba_od_poverenja: contactLine(p.trustedPerson?.name ? (p.trustedPerson as { name: string }) : undefined),
    kontakt_osoba: contactLine(primary) || patient.contactPerson || "",
    hitni_kontakt: contactLine(contacts.find((c) => c.emergency)),
    datum_plana: fmtDay(plan?.date),
    rok_pregleda_plana: fmtDay(plan?.nextReview),
    ustanova: facility?.name ?? "",
    ustanova_adresa: join(facility?.address, facility?.city),
    ustanova_telefon: facility?.phone ?? "",
    danas: fmtDay(new Date()),
  };

  const lists = {
    kontakti: contacts.map((c) => ({
      kontakt_ime: c.name,
      kontakt_srodstvo: c.relation ?? "",
      kontakt_telefon: c.phone ?? "",
      kontakt_email: c.email ?? "",
      kontakt_adresa: c.address ?? "",
    })),
    ciljevi: (plan?.goals ?? []).map((goal, i) => ({
      rb: String(i + 1),
      cilj: goal.goal,
      ishod: goal.outcome ?? "",
      aktivnosti: goal.activities ?? "",
      odgovorni: goal.responsible ?? "",
      rok: fmtDay(goal.due),
    })),
  };

  return { fields, lists };
}
