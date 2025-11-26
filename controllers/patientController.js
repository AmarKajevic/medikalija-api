import Patient from "../models/Patient.js"
import Specification from "../models/Specification.js";

const getPatients = async (req, res) => {
    try{
        const patients = await Patient.find().populate("createdBy", "name role").sort({createdAt: -1 })
        return res.status(200).json({success: true, patients})
    }catch(error){
         return res.status(500).json({success: false, error: "get patient server error"})
    }
    
}

const getPatient = async(req, res) => {
    try {
        
        const {id} = req.params
        const patient = await Patient.findById({_id : id})
        if (!patient) {
      return res
        .status(404)
        .json({ success: false, error: "Patient not found" });
    }
        return res.status(200).json({success: true, patient})
        
    } catch (error) {
         return res.status(500).json({success: false, error: "get patient server error"})
    }
}
const addPatient = async(req, res) => {
      try {
    if (req.user.role !== "admin" && req.user.role !== "main-nurse") {
      return res.status(403).json({ success: false, message: "Nemate dozvolu da dodate pacijenta" });
    }

    const { name, lastName, dateOfBirth, address, admissionDate } = req.body;

    const patient = await Patient.create({
      name,
      lastName,
      dateOfBirth,
      address,
      admissionDate,
      createdBy: req.user._id,
    });

    res.status(201).json({ success: true, patient });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
const deletePatient = async(req, res) => {
    try {
        if (req.user.role !== "admin" && req.user.role !== "main-nurse") {
  return res.status(403).json({ success: false, message: "Nemate dozvolu da obrišete pacijenta" });
        }

    const {id} = req.params;
    const deletePatient = await Patient.findByIdAndDelete({_id: id})
    if(deletePatient) {
        return res.status(200).json({success:true, message:"pacijent je uspesno izbrisan"})
    }
    
    }catch(error){
        res.status(500).json({success: false, error: error.message});
    }
}
const dischargePatient = async (req, res) => {
  try {
    const { id } = req.params;
    const { dischargeDate } = req.body;

    const patient = await Patient.findById(id);
    if (!patient) {
      return res.status(404).json({ success: false, message: "Pacijent nije pronađen." });
    }

    // 🩺 Postavi datum otpusta
    patient.dischargeDate = new Date(dischargeDate);
    await patient.save();

    // 🔎 Pronađi aktivnu specifikaciju za pacijenta
    const activeSpec = await Specification.findOne({
      patientId: id,
      endDate: { $gte: new Date() },
    });

    if (activeSpec) {
      // ✂️ Prekini specifikaciju na dan otpusta
      activeSpec.endDate = new Date(dischargeDate);
      activeSpec.isActive = false;
      await activeSpec.save();
    }

    return res.json({
      success: true,
      message: "Pacijent uspešno otpušten. Specifikacija završena.",
    });
  } catch (err) {
    console.error("Greška pri otpustu pacijenta:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
};




export {getPatients,addPatient, getPatient, deletePatient, dischargePatient}