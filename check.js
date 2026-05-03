require('dotenv').config();

async function run() {
    console.log("🔍 Asking Google what models are unlocked for your key...");
    
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        
        if (data.models) {
            const geminiModels = data.models.map(m => m.name).filter(name => name.includes('gemini'));
            console.log("\n✅ AVAILABLE GEMINI MODELS:");
            console.log(geminiModels);
        } else {
            console.log("\n❌ Error fetching models:", data);
        }
    } catch (err) {
        console.log("\n❌ Failed to connect:", err.message);
    }
}

run();