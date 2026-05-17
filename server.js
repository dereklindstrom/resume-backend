require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3001; 

// 🛡️ SECURITY: Allow frontend to talk to backend
app.use(cors({ origin: '*' }));

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
        console.error("❌ Error initializing database (This is expected if no Postgres URL is provided):", err.message);
    }
};

app.post('/api/generate-resume', async (req, res) => {
    try {
        // 🌟 THE FIX: Correctly unpack the new 3-part package from the frontend!
        const { userData, customPrompt, tier, photo } = req.body;

        if (!userData) {
            throw new Error("Missing userData in request body.");
        }

        console.log(`🔥 Processing AI generation for: ${userData.baseline?.name || "User"} | Tier: ${tier || 'free'}`);

        // Safely extract education
        const eduArray = userData.experienceDetails?.eduDetails || [];
        const edu = eduArray.length > 0 ? eduArray[0] : {}; 
        const showEdu = userData.experienceDetails?.showEdu || false;
        
        const workHistory = userData.experienceDetails?.workHistory || [];
        
        const educationBlock = showEdu 
            ? `Degree: ${edu.degree || 'N/A'}\nSchool: ${edu.school || 'N/A'}` 
            : "No education listed.";

        const workHistoryBlock = workHistory.length > 0 ? workHistory.map(job => 
            `Company: ${job.company}\nTitle: ${job.jobTitle || job.title}\nDates: ${job.dates}\nResponsibilities: ${job.description || job.responsibilities}\nAchievements: ${job.achievements || "N/A"}`
        ).join('\n\n--- NEXT ROLE ---\n\n') : "No work history provided.";

        const confirmedSkillsList = userData.objective?.confirmedSkills?.join(", ") || "Leadership, Management, Operations";

        const prompt = `
            You are an elite, executive resume writer and career coach.
            
            CANDIDATE INFO:
            - Name: ${userData.baseline?.name || "Candidate"}
            - Target Industry: ${userData.objective?.targetIndustry || "General Business"}
            - Specific Target Role: ${userData.objective?.targetRole || "Leadership"}

            WORK HISTORY:
            ${workHistoryBlock}

            BEHAVIORAL ACHIEVEMENTS:
            - Story 1: ${userData.stories?.q1Text || "None provided"}
            - Story 2: ${userData.stories?.q2Text || "None provided"}
            - Story 3: ${userData.stories?.q3Text || "None provided"}

            EDUCATION:
            ${educationBlock}

            INSTRUCTIONS:
            1. Write a 3-sentence professional summary positioning the candidate for the Target Role.
            2. For "skills", ONLY use: [${confirmedSkillsList}].
            3. CRITICAL: You MUST create an entry in the "experience" array for EVERY single job listed in the WORK HISTORY section above. Do not skip any jobs.
            4. For each job in "experience", write a 2-sentence "roleOverview" highlighting leadership.
            5. For each job in "experience", create a "metrics" array. Convert the candidate's raw "Responsibilities" and "Achievements" into powerful, action-verb bullet points.
            6. CRITICAL INSTRUCTION: You MUST generate a "coaching" object. 
            7. In "coaching", provide EXACTLY 3 "suggestedRoles" based on their history.
            8. In "coaching", provide EXACTLY 2 "skillGaps" they need to learn to get the Target Role, including a specific "resource".

            🌟 TIER-SPECIFIC AI RULES (CRITICAL):
            ${customPrompt || "Format professionally and cleanly."}

            YOU MUST RETURN VALID JSON MATCHING THIS EXACT SCHEMA:
            {
              "summary": "...",
              "skills": ["..."],
              "education": { "degree": "...", "school": "..." },
              "experience": [ { "company": "...", "title": "...", "dates": "...", "roleOverview": "...", "metrics": ["..."] } ],
              "coaching": {
                "suggestedRoles": ["Role 1", "Role 2", "Role 3"],
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
        
        const parts = [prompt];

        if (photo) {
            parts.push({
                inlineData: {
                    data: photo.replace(/^data:image\/\w+;base64,/, ""),
                    mimeType: "image/jpeg"
                }
            });
        }

        const result = await aiModel.generateContent(parts);
        const aiSummary = result.response.text();
        console.log("✨ Gemini has finished writing!");

        try {
            if (process.env.DATABASE_URL) {
                const userInsert = await pool.query(
                    `INSERT INTO users (name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
                    [userData.baseline?.name, userData.baseline?.email, userData.baseline?.phone]
                );
                const newUserId = userInsert.rows[0].id;
    
                await pool.query(
                    `INSERT INTO resumes (user_id, target_industry, core_strength, final_ai_summary) VALUES ($1, $2, $3, $4)`,
                    [newUserId, userData.objective?.targetIndustry, userData.objective?.coreStrength, aiSummary]
                );
            }
        } catch (dbError) {
            console.log("⚠️ DB Save skipped or failed, but AI generated successfully.", dbError.message);
        }

        res.json({ success: true, resume: aiSummary });

    } catch (error) {
        console.error("❌ CRITICAL BACKEND ERROR:", error);
        res.status(500).json({ error: "Failed to generate resume with AI.", details: error.message });
    }
});

app.listen(PORT, async () => {
    console.log(`🚀 Secure backend running on port ${PORT}`);
    await initializeDatabase();
});