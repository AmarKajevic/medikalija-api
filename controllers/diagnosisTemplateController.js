import DiagnosisTemplate from "../models/DiagnosisTemplate.js";

const addDiagnosisTemplate = async  (req, res) => {
    try {
        const{ _id} = req.body;
        if(req.user.role !== "admin" && req.user.role !== "main-nurse"){
            return res.status(403).json({success: false, message: "Nemate dozvolu za dodavanje dijagnoza"});
        }
        const {name, description} = req.body;
        if(!name ){
            return res.status(400).json({success: false, message:"nedostaje naziv dijagnoze"})
        }

        const newDiagnosisTemaplate = new DiagnosisTemplate({
            name,
            description,
            createdBy: req.user._id
        })
        await newDiagnosisTemaplate.save()

        if(newDiagnosisTemaplate){
            return res.status(201).json({success: true, message: "dijagnoza je dodata"})
        }


    } catch (error) {
        return res.status(500).json({success: false, error: error.message, message:"greska je na serveru"})
    }
}

const getDiagnosisTemplate = async (req, res ) => {
    try {
        const diagnosisTemplates = await DiagnosisTemplate.find().populate("createdBy","role name")
        return res.status(200).json({success:true, diagnosisTemplates})
    } catch (error) {
        return res.status(500).json({success:!false, error: error.message,})
    }
}
export {addDiagnosisTemplate, getDiagnosisTemplate}