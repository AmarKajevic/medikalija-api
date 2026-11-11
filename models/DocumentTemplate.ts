import mongoose, { type InferSchemaType } from "mongoose";

// Word šabloni ustanove (.docx sa poljima kao {ime_prezime}, {jmbg}, tabelama {#kontakti}…{/kontakti}).
// Pravi ih socijalni radnik u Wordu i postavlja u aplikaciju; aplikacija ih popunjava podacima korisnika.
// Fajl se čuva u bazi (do 2 MB) i ne vraća se u listi.
export const TEMPLATE_MAX_BYTES = 2 * 1024 * 1024;

const documentTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, required: true, maxlength: 120 },
    description: { type: String, trim: true, default: "", maxlength: 300 },
    fileName: { type: String, trim: true, required: true, maxlength: 200 },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

documentTemplateSchema.index({ name: 1 });

export type DocumentTemplateAttrs = InferSchemaType<typeof documentTemplateSchema>;

export default mongoose.model("DocumentTemplate", documentTemplateSchema);
