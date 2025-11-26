import Combination from "../models/Combination.js"
import CombinationGroup from "../models/CombinationGroup.js"


const addCombinationToGroup = async (req, res) => {
  try {
    const { name, combinations } = req.body;

    if (!name || !combinations || combinations.length === 0) {
      return res.status(400).json({ success: false, message: "Naziv grupe i kombinacije su obavezni." });
    }

    // Nađi kombinacije po ID-jevima
    const combs = await Combination.find({ _id: { $in: combinations } }).populate("analyses");

    if (!combs || combs.length === 0) {
      return res.status(404).json({ success: false, message: "Nijedna kombinacija nije pronađena." });
    }

    // Formatiraj kombinacije
    const combWithDetails = combs.map(c => ({
      _id: c._id,
      name: c.name,
      totalPrice: c.totalPrice,
      analyses: c.analyses.map(a => a._id), // ✅ uvek samo ID-jevi
    }));

    // Proveri postoji li grupa
    let group = await CombinationGroup.findOne({ name });

    if (group) {
      // ✅ Prvo osiguraj da već postojeće kombinacije imaju analize kao ID-jeve
      group.combinations = group.combinations.map(c => ({
        ...c.toObject(),
        analyses: Array.isArray(c.analyses)
          ? c.analyses.map(a => (typeof a === "object" && a._id ? a._id : a))
          : [],
      }));

      // ✅ Dodaj nove kombinacije
      group.combinations.push(...combWithDetails);

      await group.save();
      return res.status(200).json({ success: true, message: "Kombinacije dodate u postojeću grupu", group });
    } else {
      // ✅ Kreiraj novu grupu
      group = new CombinationGroup({
        name,
        combinations: combWithDetails,
        // createdBy: req.user._id,
      });

      await group.save();
      return res.status(201).json({ success: true, group });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


const getGroups = async (req, res)=> {
    try{
        const groups = await CombinationGroup.find().populate({
      path: "combinations.analyses",
      model: "Analysis"
    });

        const formatted = groups.map((g) => ({
          _id: g._id,
          name: g.name,
          combinations : g.combinations?.map((c) => ({
            _id: c._id,
            name: c.name,
            totalPrice: c.totalPrice,
            analyses: c.analyses?.map((a) => ({
              totalPrice : c.analyses.reduce((sum, a) => sum + (a.price || 0), 0),
              _id: a._id,
              name: a.name,
              price: a.price

            }))
          }))
        }))
        if(groups) {
            return res.status(200).json({success: true, groups: formatted});
        }

    }catch(error){
        return res.status(500).json({success: false, message: error.message});
    }
    
    
}


export{addCombinationToGroup,getGroups}