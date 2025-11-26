import Diagnosis from "../models/Diagnosis.js";
import DiagnosisTemplate from "../models/DiagnosisTemplate.js"; // importuj model šablona
import Patient from "../models/Patient.js";
import { createNotification } from "../services/notificationService.js";

const addDiagnosis = async (req, res) => {
    try {
        const { patientId, description, templateId, name } = req.body;

        let diagnosisName = name
        let finalDescription = description;

        if(templateId){
            const template = await DiagnosisTemplate.findById(templateId);
            if(!template) return res.status(404).json({success: false, error: "Šablon ne postoji"});
            diagnosisName = template.name
            finalDescription = template.description; // ili template.description ako hoćeš detaljniji opis
            
        }

        if(!patientId || !finalDescription){
            return res.status(400).json({success: false, error:"missing fields"});
        }
            const patient = await Patient.findById(patientId)

        const userId = req.user._id;

        const newDiagnosis = new Diagnosis({
            patient: patientId,
            description: finalDescription,
            diagnosis: diagnosisName,
            createdBy: userId,
        });
        // 📌 OBAVEŠTENJE
            await createNotification(
              patient.createdBy,
              "diagnosis",
              `${req.user.name} ${req.user.lastName} je dodao/la analizu pacijentu ${patient.name} ${patient.lastName}.`

            );

        await newDiagnosis.save();
        const populatedDiagnosis = await newDiagnosis.populate("createdBy", "name role");

        res.status(201).json({success: true, diagnosis: populatedDiagnosis});
    } catch (error) {
        console.log(error)
        res.status(500).json({success: false, error: "Server error"});
    }
}

const getDiagnosis = async (req, res) => {
    const {patientId} = req.params;
    try {
        const diagnosis = await Diagnosis.find({patient: patientId}).populate("createdBy", "name role").sort({ createdAt: -1 });
        return res.status(200).json({success: true, diagnosis})
    } catch (error) {
        console.log(error)
        return res.status(500).json({success: false, error:"server error"})
    }
}

export { addDiagnosis, getDiagnosis }
