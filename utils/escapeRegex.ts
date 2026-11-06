// Unos korisnika se nikad ne prosleđuje direktno u RegExp: znakovi poput ".*(" bi
// promenili značenje upita ili omogućili ReDoS (zagušenje servera sporim regexom).
export const escapeRegex = (value: unknown): string => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
