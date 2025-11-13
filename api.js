/**
 * This is a Vercel Serverless Function (API Route).
 * It will live at the URL: /api/get-run-data
 *
 * It accepts 3 query parameters:
 * 1. id: The main Run ID
 * 2. player_id: The ID of the player you want to analyze
 * 3. gate_id: The ID of the gate you want to analyze (e.g., "Total", "Pride", etc.)
 *
 * Example: /api/get-run-data?id=776482144628289536&player_id=62257&gate_id=776482144628289536
 */

export default async function handler(request, response) {
    try {
        const { id, player_id, gate_id } = request.query;

        if (!id || !player_id || !gate_id) {
            return response.status(400).json({ 
                error: "Missing required query parameters. 'id', 'player_id', and 'gate_id' are all required." 
            });
        }

        // --- Step 1: Fetch the Main Run Data ---
        // This is the server-side fetch. No CORS issues here!
        const runUrl = `https://fatduckdn.com/api/v2/game/dps/${id}`;
        const runResponse = await fetch(runUrl);
        if (!runResponse.ok) {
            throw new Error(`Failed to fetch run data: ${runResponse.statusText}`);
        }
        const runData = await runResponse.json();

        // --- Step 2: Find the Correct Player and Gate ---
        const gate = runData.gates.find(g => g.id === gate_id);
        if (!gate) {
            throw new Error(`Gate with ID '${gate_id}' not found.`);
        }

        const player = gate.players.find(p => p.id == player_id); // Use == for safety, as one might be string
        if (!player) {
            throw new Error(`Player with ID '${player_id}' not found in gate '${gate.name}'.`);
        }

        const totalDamage = parseInt(player.damageDealt.replace(/\./g, ''), 10);
        if (totalDamage === 0) {
            return response.status(200).json({ message: "Player has 0 damage for this gate.", data: [] });
        }

        // --- Step 3: Get All Skill IDs for this Player ---
        const skillIds = player.skills.map(s => s.id);
        const uniqueSkillIds = [...new Set(skillIds)]; // Remove duplicates

        // --- Step 4: Fetch All Skill Names in Parallel ---
        const skillNamePromises = uniqueSkillIds.map(skillId => {
            // Skip "Basic Attack" which has id -1
            if (skillId < 0) {
                return { id: skillId, name: 'Basic Attack' };
            }
            const skillUrl = `https://minerva.fatduckdn.com/api/server/duck/tables/virt.skilltable/${skillId}?uiresolve=_NameID&select=_NameID`;
            
            // We return the fetch promise itself
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

        // --- Step 5: Create the Skill Dictionary (ID -> Name) ---
        const skillDictionary = skillNameEntries.reduce((acc, curr) => {
            acc[curr.id] = curr.name;
            return acc;
        }, {});

        // --- Step 6: Process and Clean the Data (Same logic as our HTML tool) ---
        const cleanedData = player.skills.map(skill => {
            const damage = parseInt(skill.damage.replace(/\./g, ''), 10);
            const percent = parseFloat(((damage / totalDamage) * 100).toFixed(1));

            const crits = skill.hitCounts[1] || 0;
            const totalHits = skill.hitCounts.reduce((a, b) => a + b, 0);
            const critHitsStr = `${crits} / ${totalHits}`;
            const critRate = (totalHits > 0) ? parseFloat(((crits / totalHits) * 100).toFixed(1)) : 0.0;

            return {
                name: skillDictionary[skill.id] || `Unknown Skill (${skill.id})`,
                damage: damage,
                percent: percent,
                crit_hits: critHitsStr,
                crit_rate: critRate
            };
        }).sort((a, b) => b.damage - a.damage); // Sort by damage descending

        // --- Step 7: Send the Final JSON Response ---
        // Set cache headers to allow Vercel to cache this response
        response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); // Cache for 1 hour
        return response.status(200).json(cleanedData);

    } catch (error) {
        console.error(error);
        return response.status(500).json({ error: error.message });
    }
}
