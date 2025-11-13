/**
 * This is a Vercel Serverless Function (API Route).
 * It will live at the URL: /api/get-run-data
 *
 * It accepts ONE query parameter:
 * 1. id: The main Run ID (e.g., 776482144628289536)
 *
 * It returns a large JSON object with all the raw data needed for the frontend:
 * {
 * "runData": { ... full data for the run ... },
 * "skillDictionary": { "6802": "Pursuer (Shadow)", ... }
 * }
 */

export default async function handler(request, response) {
    try {
        const { id } = request.query;

        if (!id) {
            return response.status(400).json({ 
                error: "Missing required query parameter: 'id'" 
            });
        }

        // --- Step 1: Fetch the Main Run Data ---
        // This is the server-side fetch. No CORS issues here!
        const runUrl = `https://fatduckdn.com/api/v2/game/dps/${id}`;
        const runResponse = await fetch(runUrl);
        if (!runResponse.ok) {
            throw new Error(`Failed to fetch run data (ID: ${id}): ${runResponse.statusText}`);
        }
        const runData = await runResponse.json();

        // --- Step 2: Get All Unique Skill IDs from All Players/Gates ---
        const allSkillIds = new Set();
        if (runData.gates && runData.gates.length > 0) {
            runData.gates.forEach(gate => {
                if (gate.players && gate.players.length > 0) {
                    gate.players.forEach(player => {
                        if (player.skills && player.skills.length > 0) {
                            player.skills.forEach(skill => {
                                // Add all skill IDs. Do not add IDs less than 0 (like Basic Attack)
                                if (skill.id > 0) {
                                    allSkillIds.add(skill.id);
                                }
                            });
                        }
                    });
                }
            });
        }
        const uniqueSkillIds = Array.from(allSkillIds);

        // --- Step 3: Fetch All Skill Names in Parallel ---
        const skillNamePromises = uniqueSkillIds.map(skillId => {
            const skillUrl = `https://minerva.fatduckdn.com/api/server/duck/tables/virt.skilltable/${skillId}?uiresolve=_NameID&select=_NameID`;
            
            return fetch(skillUrl)
                .then(res => res.json())
                .then(data => ({
                    id: skillId,
                    name: data._NameID_txt || `Unknown Skill (${skillId})`
                }))
                .catch(e => ({
                    id: skillId,
                    name: `Error Skill (${skillId})`
                }));
        });

        const skillNameEntries = await Promise.all(skillNamePromises);

        // --- Step 4: Create the Skill Dictionary (ID -> Name) ---
        const skillDictionary = skillNameEntries.reduce((acc, curr) => {
            acc[curr.id] = curr.name;
            return acc;
        }, {});
        
        // Add Basic Attack manually since it's not in the API
        skillDictionary["-1"] = "Basic Attack";

        // --- Step 5: Send the Final Combined JSON Response ---
        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); // Cache for 1 hour
        return response.status(200).json({
            runData: runData,
            skillDictionary: skillDictionary
        });

    } catch (error) {
        console.error(error);
        return response.status(500).json({ error: error.message });
    }
}
