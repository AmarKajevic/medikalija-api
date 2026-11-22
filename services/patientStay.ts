// Boravci korisnika: kad se otpušten korisnik ponovo primi, raniji boravak ide u previousStays,
// a dokumentacija i periodi specifikacija se vode od novog prijema.
import { addDays, normalizeStoredDay } from "../utils/dateUtils.js";

type StayPatient = {
  admissionDate?: Date | null;
  previousStays?: Array<{ admissionDate: Date; dischargeDate: Date }> | null;
};

/**
 * Prvi dan od kog važi dokumentacija tekućeg boravka: dan posle otpusta iz prethodnog boravka.
 * Za korisnika bez ranijih boravaka null (važi sva dokumentacija — i ona pre prijema, npr. prijemna procena).
 */
export function currentStayFrom(patient: StayPatient | null | undefined): Date | null {
  const stays = patient?.previousStays ?? [];
  if (!stays.length) return null;
  const last = stays.reduce((a, b) => (new Date(a.dischargeDate) > new Date(b.dischargeDate) ? a : b));
  const end = normalizeStoredDay(last.dischargeDate);
  return end ? addDays(end, 1) : null;
}

/** Datum prijema tekućeg boravka, ako korisnik ima ranije boravke (periodi kreću od njega) */
export function readmissionStart(patient: StayPatient | null | undefined): Date | null {
  return patient?.previousStays?.length ? normalizeStoredDay(patient.admissionDate ?? null) : null;
}
