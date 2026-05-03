require('dotenv').config();
const express = require('express');
const cors = require('cors');
app.use(cors({
    origin: '*' 
}));
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001; 

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.use(cors());
// 🛡️ UPGRADE: Increase payload limit to 50mb so large webcam photos don't crash the server!
app.use(express.json({ limit: '50mb' })); 

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 🛡️ THE BULLETPROOF COMBO: Standard Flash + JSON Mode
const aiModel = genAI.getGenerativeModel({ 
    model: "gemini-3.1-flash-lite-preview",
    generationConfig: {
        responseMimeType: "application/json",
    }
});

const initializeDatabase = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                phone VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS resumes (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                target_industry VARCHAR(255),
                core_strength VARCHAR(255),
                final_ai_summary TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Database tables verified.");
    } catch (err) {
        console.error("❌ Error initializing database:", err);
    }
};

app.post('/api/generate-resume', async (req, res) => {
    try {
        const userData = req.body;
        console.log(`🔥 Processing real AI generation for: ${userData.baseline?.name || "User"}`);

        // 🛡️ UPGRADE: Safely extract data so Node never crashes if a field is empty
        const edu = userData.experienceDetails?.eduDetails || {};
        const showEdu = userData.experienceDetails?.showEdu || false;
        const workHistory = userData.experienceDetails?.workHistory || [];
        
        const educationBlock = showEdu 
            ? `Degree: ${edu.degree || 'N/A'}\nSchool: ${edu.school || 'N/A'}` 
            : "No education listed.";

        const workHistoryBlock = workHistory.map(job => 
            `Company: ${job.company}\nTitle: ${job.jobTitle}\nDates: ${job.startDate} to ${job.endDate}\nResponsibilities: ${job.responsibilities}\nAchievements: ${job.achievements}`
        ).join('\n\n--- NEXT ROLE ---\n\n');

        const confirmedSkillsList = userData.objective?.confirmedSkills?.join(", ") || "General Skills";

        const prompt = `
            You are an elite, executive resume writer and career coach.
            
            CANDIDATE INFO:
            - Name: ${userData.baseline?.name || ""}
            - Target Industry: ${userData.objective?.targetIndustry || ""}
            - Specific Target Role: ${userData.objective?.targetRole || ""}

            WORK HISTORY:
            ${workHistoryBlock}

            BEHAVIORAL ACHIEVEMENTS:
            - Story 1 (at ${userData.stories?.q1Job}): ${userData.stories?.q1Text}
            - Story 2 (at ${userData.stories?.q2Job}): ${userData.stories?.q2Text}
            - Story 3 (at ${userData.stories?.q3Job}): ${userData.stories?.q3Text}

            INSTRUCTIONS:
            1. Write a 3-sentence professional summary positioning the candidate for the Target Role.
            2. For "skills", ONLY use: [${confirmedSkillsList}].
            3. For "experience", write a 2-sentence "roleOverview" highlighting leadership.
            4. Extract the Behavioral Achievements into the "metrics" array for the specific company.
            5. CRITICAL INSTRUCTION: You MUST generate a "coaching" object. 
            6. In "coaching", provide EXACTLY 3 "suggestedRoles" based on their history.
            7. In "coaching", provide EXACTLY 2 "skillGaps" they need to learn to get the Target Role, including a specific "resource" (e.g., Google Data Analytics Certificate, PMP Certification, etc.).

            YOU MUST RETURN VALID JSON MATCHING THIS EXACT SCHEMA:
            {
              "summary": "...",
              "skills": ["..."],
              "education": { "degree": "...", "school": "..." },
              "experience": [ { "company": "...", "title": "...", "dates": "...", "roleOverview": "...", "metrics": ["..."] } ],
              "coaching": {
  "suggestedRoles": ["Role 1", "Role 2"],
  "skillGaps": [
    {
      "skill": "Name of the skill",
      "reason": "Why they need it",
      "freeResource": "Specific free course or certification name",
      "paidResource": "Specific premium industry certification name"
    }
  ]
}
            }
        `;

        console.log("🧠 Asking Gemini to write the resume...");
        
        // 1. Start with the text prompt
        const parts = [prompt];

        // 2. Safely check if a photo came from the frontend, and format it for Gemini
        if (req.body.photo) {
            parts.push({
                inlineData: {
                    data: req.body.photo.replace(/^data:image\/\w+;base64,/, ""),
                    mimeType: "image/jpeg"
                }
            });
        }

        // 3. Hand the package to the AI
        const result = await aiModel.generateContent(parts);
        const aiSummary = result.response.text();
        console.log("✨ Gemini has finished writing!");

        // Save to Database
        const userInsert = await pool.query(
            `INSERT INTO users (name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
            [userData.baseline?.name, userData.baseline?.email, userData.baseline?.phone]
        );
        const newUserId = userInsert.rows[0].id;

        await pool.query(
            `INSERT INTO resumes (user_id, target_industry, core_strength, final_ai_summary) VALUES ($1, $2, $3, $4)`,
            [newUserId, userData.objective?.targetIndustry, userData.objective?.coreStrength, aiSummary]
        );

        res.json({ success: true, resume: aiSummary });

    } catch (error) {
        console.error("❌ CRITICAL BACKEND ERROR:", error);
        res.status(500).json({ error: "Failed to generate resume with AI.", details: error.message });
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 Secure backend running on http://localhost:${PORT}`);
    await initializeDatabase();
});