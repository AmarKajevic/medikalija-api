// Polja za Word šablone: jedan katalog (naziv polja, opis, grupa) i jedno mesto gde se
// popunjavaju iz podataka korisnika. Podatak unet jednom (npr. JMBG, staratelj) pojavljuje se
// u svakom šablonu koji koristi to polje. Nazivi su bez kvačica da se lako kucaju u Wordu.
import Patient from "../../models/Patient.js";
import SocialProfile from "../../models/SocialProfile.js";
import SocialDocument from "../../models/SocialDocument.js";
import SocialNote from "../../models/SocialNote.js";
import GlobalSetting, { DEFAULT_FACILITY } from "../../models/GlobalSetting.js";
import { calendarDayInZone, normalizeStoredDay } from "../../utils/dateUtils.js";
import { genderWords, scaleFields } from "./formFields.js";
import type { ScaleScores } from "./supportScale.js";

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
  F("Korisnik", "datum_i_mesto_rodjenja", "Datum i mesto rođenja"),
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
  F("Korisnik", "prezime_ime", "Prezime i ime"),
  F("Korisnik", "prezime_roditelj_ime", "Prezime, ime jednog roditelja i ime"),
  F("Korisnik", "godina_rodjenja", "Godina rođenja"),
  F("Korisnik", "prezime_pre_braka", "Prezime pre zaključenja braka"),
  F("Korisnik", "otac", "Prezime i ime oca"),
  F("Korisnik", "majka", "Prezime i ime majke i njeno devojačko prezime"),
  F("Korisnik", "bracni_drug", "Bračni drug (ime, devojačko prezime, adresa)"),
  F("Korisnik", "nacionalnost", "Nacionalnost"),
  F("Korisnik", "veroispovest", "Veroispovest"),
  F("Korisnik", "socijalni_status", "Socijalni status"),
  F("Korisnik", "osiguranje_osnov", "Zdravstveno osiguranje — osnov"),
  F("Korisnik", "imovina", "Podaci o imovini"),
  F("Korisnik", "telefon", "Telefon korisnika"),
  F("Korisnik", "email", "E-pošta korisnika"),
  F("Korisnik", "dijagnoza", "Bolest (za izjavu srodnika)"),
  F("Prijem", "datum_zahteva", "Datum zahteva za prijem"),
  F("Prijem", "podnosilac", "Podnosilac zahteva / obveznik ugovora"),
  F("Prijem", "podnosilac_srodstvo", "Srodstvo podnosioca"),
  F("Prijem", "podnosilac_adresa", "Adresa podnosioca"),
  F("Prijem", "podnosilac_jmbg", "JMBG podnosioca"),
  F("Prijem", "podnosilac_lk", "Broj lične karte podnosioca"),
  F("Prijem", "podnosilac_telefon", "Telefon podnosioca"),
  F("Prijem", "podnosilac_email", "E-pošta podnosioca"),
  F("Prijem", "placa_smestaj_tekst", "Ko snosi troškove (kako piše u zahtevu)"),
  F("Prijem", "cena_eur", "Cena smeštaja (EUR)"),
  F("Prijem", "datum_otpusta", "Datum prestanka smeštaja"),
  F("Korisnik", "lbo", "LBO / broj zdravstvene kartice"),
  F("Korisnik", "izabrani_lekar", "Izabrani lekar"),
  F("Smeštaj", "broj_dosijea", "Broj dosijea"),
  F("Smeštaj", "datum_prijema", "Datum prijema"),
  F("Smeštaj", "smestaj", "Smeštaj (odeljenje, soba)"),
  F("Smeštaj", "osnov_smestaja", "Osnov smeštaja"),
  F("Smeštaj", "osnov_smestaja_opis", "Osnov smeštaja sa brojem ugovora / rešenja"),
  F("Smeštaj", "broj_ugovora", "Broj ugovora"),
  F("Smeštaj", "datum_ugovora", "Datum ugovora"),
  F("Smeštaj", "csr", "Centar za socijalni rad"),
  F("Smeštaj", "voditelj_slucaja", "Voditelj slučaja"),
  F("Smeštaj", "broj_resenja_csr", "Broj rešenja CSR-a"),
  F("Smeštaj", "datum_resenja_csr", "Datum rešenja CSR-a"),
  F("Smeštaj", "penzija", "Vrsta penzije"),
  F("Smeštaj", "prihodi", "Prihodi (penzija i napomena)"),
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
  F("Procena", "datum_procene", "Datum poslednje procene"),
  F("Procena", "anamneza", "Socijalna anamneza"),
  F("Procena", "zdravstveno_stanje", "Zdravstveno stanje"),
  F("Procena", "briga_o_sebi", "Briga o sebi (funkcionalni status)"),
  F("Procena", "psihicko_stanje", "Kognitivno i psihičko stanje"),
  F("Procena", "komunikacija", "Komunikacija"),
  F("Procena", "porodica_i_veze", "Porodica i socijalne veze"),
  F("Procena", "interesovanja", "Interesovanja i navike"),
  F("Procena", "snage", "Snage korisnika"),
  F("Procena", "rizici", "Rizici"),
  F("Procena", "potrebe", "Potrebe"),
  F("Procena", "misljenje_korisnika", "Mišljenje korisnika i porodice"),
  F("Procena", "zakljucak", "Zaključak procene"),
  F("Individualni plan", "datum_plana", "Datum poslednjeg individualnog plana"),
  F("Individualni plan", "rok_pregleda_plana", "Rok za ponovni pregled plana"),
  F("Ustanova", "ustanova", "Naziv ustanove"),
  F("Ustanova", "ustanova_adresa", "Adresa ustanove"),
  F("Ustanova", "ustanova_telefon", "Telefon ustanove"),
  F("Ustanova", "danas", "Današnji datum"),
  F("Ustanova", "socijalni_radnik", "Socijalni radnik (ko pravi dokument)"),
];

/** Tabele: red u Wordu sa {#kontakti} … {/kontakti} ponavlja se za svaki kontakt */
export const MERGE_LISTS: MergeListDef[] = [
  {
    key: "kontakti",
    label: "Porodica i kontakti",
    fields: [F("", "kontakt_ime", "Ime i prezime"), F("", "kontakt_srodstvo", "Srodstvo"), F("", "kontakt_telefon", "Telefon"), F("", "kontakt_email", "E-pošta"), F("", "kontakt_adresa", "Adresa"), F("", "kontakt_napomena", "Napomena")],
  },
  {
    key: "ciljevi",
    label: "Ciljevi poslednjeg individualnog plana",
    fields: [
      F("", "rb", "Redni broj"),
      F("", "oblast", "Oblast"),
      F("", "cilj", "Cilj"),
      F("", "ishod", "Očekivani ishod"),
      F("", "aktivnosti", "Aktivnosti"),
      F("", "odgovorni", "Odgovorno lice"),
      F("", "rok", "Rok"),
    ],
  },
  {
    key: "beleske",
    label: "Službene beleške (socijalni karton)",
    fields: [F("", "beleska_datum", "Datum"), F("", "beleska_naslov", "Naslov"), F("", "beleska", "Beleška")],
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

/** Bračni status u obliku za pol korisnika ("udovica" umesto "udovac / udovica") */
function maritalLabel(status?: string, sex?: string) {
  const bySex: Record<string, [string, string]> = {
    single: ["neoženjen", "neudata"],
    married: ["oženjen", "udata"],
    divorced: ["razveden", "razvedena"],
    widowed: ["udovac", "udovica"],
  };
  const pair = bySex[status ?? ""];
  if (pair && sex === "M") return pair[0];
  if (pair && sex === "Ž") return pair[1];
  return LABELS.marital![status ?? ""] ?? "";
}

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

/** "ugovor br. 112/2026 od 14.03.2026." ili "rešenje CSR Beograd br. … od …" */
function placementText(p: { placementBasis?: string; contractNumber?: string; contractDate?: Date | null; csrName?: string; csrDecisionNumber?: string; csrDecisionDate?: Date | null }) {
  const no = (n?: string) => (n ? ` br. ${n}` : "");
  const on = (d?: Date | null) => (d ? ` od ${fmtDay(d)}` : "");
  if (p.placementBasis === "contract") return `Ugovor o smeštaju${no(p.contractNumber)}${on(p.contractDate)}`;
  if (p.placementBasis === "csr") return `Rešenje ${p.csrName || "centra za socijalni rad"}${no(p.csrDecisionNumber)}${on(p.csrDecisionDate)}`;
  return "";
}

/** Svi podaci korisnika za šablone: polja (tekst) i tabele (nizovi redova). Prazno polje je "". */
export async function buildMergeData(patientId: string, author?: { name: string; lastName: string } | null) {
  // Poslednji dokument svake vrste iz obrazaca (zaključen ima prednost, pa najnoviji)
  const latest = (type: string) => SocialDocument.findOne({ patient: patientId, type }).sort({ status: -1, date: -1, createdAt: -1 }).lean();
  const [intakeDoc, anamnesisDoc, assessmentDoc, scaleDoc, planDoc, reviewDoc] = await Promise.all(
    ["intake", "anamnesis", "assessment", "support_scale", "plan", "plan_review"].map(latest)
  );
  const [patient, profile, plan, assessment, notes, settings] = await Promise.all([
    Patient.findById(patientId).lean(),
    SocialProfile.findOne({ patient: patientId }).populate<{ assignedStaff: { name: string; lastName: string } | null }>("assignedStaff", "name lastName").lean(),
    SocialDocument.findOne({ patient: patientId, type: { $in: ["plan", "plan_review"] }, status: "final" }).sort({ date: -1 }).lean(),
    // Poslednja zaključena procena (ili nacrt, ako zaključene još nema)
    SocialDocument.findOne({ patient: patientId, type: { $in: ["assessment", "reassessment"] } }).sort({ status: -1, date: -1 }).lean(),
    SocialNote.find({ patient: patientId }).sort({ date: 1 }).limit(200).lean(),
    GlobalSetting.findOne().lean(),
  ]);
  if (!patient) return null;
  const p = profile ?? ({} as Partial<NonNullable<typeof profile>>);
  const birth = normalizeStoredDay(patient.dateOfBirth ?? null);
  const contacts = p.contacts ?? [];
  const primary = contacts.find((c) => c.emergency) ?? contacts[0];
  const contactLine = (c?: { name: string; relation?: string; phone?: string }) => (c ? join(c.name, c.relation, c.phone) : "");
  const g = p.guardian;
  const sections = (assessment?.sections ?? {}) as Record<string, string>;
  const section = (key: string) => sections[key] ?? "";
  // Dok admin ne sačuva podešavanja ustanove, važe podrazumevani podaci (kao u zaglavlju aplikacije)
  const facility = settings?.facility ?? DEFAULT_FACILITY;

  const fields: Record<string, string> = {
    ime: patient.name,
    prezime: patient.lastName,
    ime_prezime: `${patient.name} ${patient.lastName}`,
    jmbg: p.jmbg ?? "",
    datum_rodjenja: fmtDay(birth),
    datum_i_mesto_rodjenja: join(fmtDay(birth), p.birthPlace),
    godine: ageOf(birth),
    mesto_rodjenja: p.birthPlace ?? "",
    ime_roditelja: p.parentName ?? "",
    pol: LABELS.sex![p.sex ?? ""] ?? "",
    adresa: patient.address ?? "",
    opstina: p.municipality ?? "",
    drzavljanstvo: p.citizenship ?? "",
    bracni_status: maritalLabel(p.maritalStatus, p.sex),
    obrazovanje: p.education ?? "",
    zanimanje: p.occupation ?? "",
    broj_licne_karte: p.idCardNumber ?? "",
    lbo: p.healthInsuranceNumber ?? "",
    izabrani_lekar: p.chosenDoctor ?? "",
    broj_dosijea: p.dossierNumber ?? "",
    datum_prijema: fmtDay(patient.admissionDate),
    smestaj: p.accommodation ?? "",
    osnov_smestaja: LABELS.placement![p.placementBasis ?? ""] ?? "",
    osnov_smestaja_opis: placementText(p),
    broj_ugovora: p.contractNumber ?? "",
    datum_ugovora: fmtDay(p.contractDate),
    csr: p.csrName ?? "",
    voditelj_slucaja: p.caseManager ?? "",
    broj_resenja_csr: p.csrDecisionNumber ?? "",
    datum_resenja_csr: fmtDay(p.csrDecisionDate),
    penzija: LABELS.pension![p.pensionType ?? ""] ?? "",
    prihodi: join(p.pensionType && p.pensionType !== "none" ? `${LABELS.pension![p.pensionType]} penzija` : LABELS.pension![p.pensionType ?? ""], p.incomeNote),
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
    datum_procene: fmtDay(assessment?.date),
    anamneza: section("socialHistory"),
    zdravstveno_stanje: section("health"),
    briga_o_sebi: section("selfCare"),
    psihicko_stanje: section("mental"),
    komunikacija: section("communication"),
    porodica_i_veze: section("socialTies"),
    interesovanja: section("interests"),
    snage: section("strengths"),
    rizici: section("risks"),
    potrebe: section("needs"),
    misljenje_korisnika: section("userView"),
    zakljucak: section("conclusion"),
    datum_plana: fmtDay(plan?.date),
    rok_pregleda_plana: fmtDay(plan?.nextReview),
    ustanova: facility?.name ?? "",
    ustanova_adresa: join(facility?.address, facility?.city),
    ustanova_telefon: facility?.phone ?? "",
    danas: fmtDay(new Date()),
    socijalni_radnik: author ? `${author.name} ${author.lastName}` : "",
  };

  // ── Obrasci postupka smeštaja ──
  const a = p.applicant ?? ({} as NonNullable<typeof p.applicant>);
  const self = a.kind === "self";
  const parent = p.parentName ?? "";
  const docSections = (doc: { sections?: unknown } | null | undefined) => (doc?.sections ?? {}) as Record<string, string>;
  const sectionFields = (prefix: string, doc: { sections?: unknown } | null | undefined) =>
    Object.fromEntries(Object.entries(docSections(doc)).map(([k, v]) => [`${prefix}_${k}`, v ?? ""]));
  const scaleScores = (scaleDoc?.scale ?? {}) as unknown as ScaleScores;
  const roman = (n: number) => ["", "I", "II", "III", "IV"][n] ?? "";
  const spouse = p.spouse;
  const trustee = p.trustee;
  const contract = p.contract;
  const signerName = self ? `${patient.name} ${patient.lastName}` : a.name ?? "";

  Object.assign(fields, {
    prezime_ime: `${patient.lastName} ${patient.name}`,
    prezime_roditelj_ime: parent ? `${patient.lastName} (${parent}) ${patient.name}` : `${patient.lastName} ${patient.name}`,
    prezime_ime_devojacko: p.maidenName ? `${patient.lastName} ${patient.name}, rođ. ${p.maidenName}` : `${patient.lastName} ${patient.name}`,
    godina_rodjenja: birth ? `${birth.getUTCFullYear()}.` : "",
    prezime_pre_braka: p.maidenName ?? "",
    otac: p.fatherName ?? "",
    majka: join(p.motherName, p.motherMaidenName ? `rođ. ${p.motherMaidenName}` : ""),
    bracni_drug: join(spouse?.name, spouse?.maidenName ? `rođ. ${spouse.maidenName}` : "", spouse?.address),
    nacionalnost: p.nationality ?? "",
    veroispovest: p.religion ?? "",
    socijalni_status: p.socialStatus ?? "",
    osiguranje_osnov: p.insuranceBasis ?? "",
    imovina: p.property ?? "",
    telefon: p.phone ?? "",
    // Obrazac 4.1: adresa i telefon korisnika u prvom redu, pa srodnici
    korisnik_kontakt: join(`${patient.name} ${patient.lastName}`, patient.address, p.phone),
    email: p.email ?? "",
    viber: p.messenger ?? "",
    dijagnoza: p.diagnosis ?? "",
    mesto_dolaska: p.municipality || patient.address || "",
    datum_zahteva: fmtDay(p.requestDate),
    datum_otpusta: fmtDay(patient.dischargeDate),
    podnosilac: signerName,
    // Ugovor ima posebno ime i prezime obveznika: prva reč je ime, ostalo prezime
    podnosilac_ime: signerName.trim().split(/\s+/)[0] ?? "",
    podnosilac_prezime: signerName.trim().split(/\s+/).slice(1).join(" "),
    ugovor_datum: fmtDay(p.contractDate) || fmtDay(new Date()),
    podnosilac_srodstvo: self ? "" : a.relation ?? "",
    podnosilac_adresa: self ? patient.address ?? "" : a.address ?? "",
    podnosilac_jmbg: self ? p.jmbg ?? "" : a.jmbg ?? "",
    podnosilac_lk: self ? p.idCardNumber ?? "" : a.idCardNumber ?? "",
    podnosilac_email: self ? p.email ?? "" : a.email ?? "",
    podnosilac_telefon: self ? p.phone ?? "" : a.phone ?? "",
    podnosilac_viber: self ? p.messenger ?? "" : a.messenger ?? "",
    placa_smestaj_tekst: p.payerNote || (LABELS.payer![p.payer ?? ""] ?? ""),
    poslovna_sposobnost_tekst: join(LABELS.legal![p.legalCapacity ?? ""], g?.authority, g?.decisionNumber ? `br. ${g.decisionNumber}` : "", fmtDay(g?.decisionDate)),
    staratelj_tekst: join(g?.name, g?.relation, g?.phone),
    poverenik: trustee?.name ?? "",
    poverenik_adresa: trustee?.address ?? "",
    poverenik_lk: trustee?.idCardNumber ?? "",
    poverenik_telefon: trustee?.phone ?? "",
    cena_eur: contract?.priceEUR != null ? String(contract.priceEUR).replace(".", ",") : "",
    racun_korisnika: contract?.bankAccount ?? "",
    stepen: roman(p.supportLevel ?? 0),
    // Stručni dokumenti (obrasci 2, 4, 10–13): datumi i delovi teksta poslednjeg dokumenta
    pp_datum: fmtDay(intakeDoc?.date),
    an_datum: fmtDay(anamnesisDoc?.date),
    pr_datum: fmtDay(assessmentDoc?.date),
    sk_datum: fmtDay(scaleDoc?.date),
    sk_ponovna: fmtDay(scaleDoc?.nextReview),
    ip_datum: fmtDay(planDoc?.date),
    ip_evaluacija: fmtDay(planDoc?.nextReview),
    pg_datum: fmtDay(reviewDoc?.date),
    ...sectionFields("pp", intakeDoc),
    ...sectionFields("an", anamnesisDoc),
    ...sectionFields("pr", assessmentDoc),
    ...sectionFields("sk", scaleDoc),
    ...sectionFields("ip", planDoc),
    ...sectionFields("pg", reviewDoc),
    ...scaleFields(scaleScores, roman),
    ...genderWords("k", p.sex),
    ...genderWords("p", self ? p.sex : a.sex),
  });

  // Oznake za izbor u obrascu (soba, kategorija, osnov prestanka) — {#soba_1}…{/soba_1}
  const flags: Record<string, boolean> = {
    podnosilac_korisnik: self,
    podnosilac_srodnik: !self && !!a.kind,
  };
  for (const [i, room] of ["single", "double", "any"].entries()) flags[`soba_${i + 1}`] = contract?.roomType === room;
  for (let i = 1; i <= 10; i++) flags[`kat_${i}`] = (contract?.categories ?? []).includes(i);
  for (let i = 1; i <= 7; i++) flags[`prestanak_${i}`] = p.dischargeReason === i;

  const lists = {
    kontakti: contacts.map((c) => ({
      kontakt_red: join(c.name, c.relation, c.address, c.phone),
      kontakt_ime: c.name,
      kontakt_srodstvo: c.relation ?? "",
      kontakt_telefon: c.phone ?? "",
      kontakt_email: c.email ?? "",
      kontakt_adresa: c.address ?? "",
      kontakt_napomena: c.note ?? "",
    })),
    ciljevi: (plan?.goals ?? []).map((goal, i) => ({
      rb: String(i + 1),
      oblast: goal.area ?? "",
      cilj: goal.goal,
      ishod: goal.outcome ?? "",
      aktivnosti: goal.activities ?? "",
      odgovorni: goal.responsible ?? "",
      rok: fmtDay(goal.due),
    })),
    // Beleška je trenutak (ne kalendarski dan): datum po vremenskoj zoni doma
    beleske: notes.map((n) => ({
      beleska_datum: fmtDay(calendarDayInZone(new Date(n.date))),
      beleska_naslov: n.title ?? "",
      beleska: n.text,
      // List praćenja: naslov i tekst u jednoj ćeliji
      beleska_tekst: n.title ? `${n.title}: ${n.text}` : n.text,
    })),
  };

  return { fields, lists, flags };
}
