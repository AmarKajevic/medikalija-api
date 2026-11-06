import bcrypt from "bcrypt";
import User from "./models/User.js";
import connectToDatabase from "./db/db.js";



 async function adminSeed () {
        connectToDatabase()
    try {
        const existingOwner = await User.findOne({role: "admin"})
        if(existingOwner) {
            console.log("Admin vec postoji", existingOwner.email)
            process.exit(0)
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash("medik123.", salt);

        const admin = new User({
            name: "Dragana",
            lastName: "Milovanovic",
            email: "drtamilo@gmail.com",
            passwordHash,
            role: "admin",

        })
        await admin.save()
        console.log("✅ Vlasnik kreiran:");
        console.log(`Email: ${admin.email}`);
        console.log(`Password: owner123`);
        process.exit(0);

        
    } catch (error) {
        console.error("Greška pri seedovanju vlasnika:", error);
    process.exit(1);
    }
}
adminSeed()