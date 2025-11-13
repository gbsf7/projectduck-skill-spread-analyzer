import { createServer } from 'http';
import { parse } from 'url';

// --- CONFIGURATION ---
// Vercel provides the port, or we default to 3000 for local testing
const PORT = process.env.PORT || 3000;

// --- MAIN SERVER LOGIC ---
const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url, true);
    const { pathname, query } = parsedUrl;

    try {
        // ROUTE 1: The Frontend (/)
        // If the user requests the root, send them the HTML page
        if (pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(HTML_CONTENT);
            return;
        }

        // ROUTE 2: The Backend API (/api/get-run-data)
        // If the frontend calls our API, run the API logic
        if (pathname === '/api/get-run-data') {
            const { id } = query;
            if (!id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Missing required query parameter: 'id'" }));
                return;
            }

            // Run the API data fetching logic
            const data = await handleApiRequest(id);
            
            // Send the successful response
            res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate'); // Cache for 1 hour
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(data));
            return;
        }

        // ROUTE 3: 404 Not Found
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));

    } catch (error) {
        // Global error handler
        console.error("Server Error:", error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message || 'An internal server error occurred.' }));
    }
});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// --- BACKEND API LOGIC ---
// This is the logic from the old api/get-run-data.js file
async function handleApiRequest(id) {
    // --- Step 1: Fetch the Main Run Data ---
    const runUrl = `https://fatduckdn.com/api/v2/game/dps/${id}`;
    const runResponse = await fetch(runUrl);
    if (!runResponse.ok) {
        throw new Error(`Failed to fetch run data (ID: ${id}): ${runResponse.statusText}`);
    }
    const runData = await runResponse.json();

    // --- Step 2: Get All Unique Skill IDs ---
    const allSkillIds = new Set();
    if (runData.gates && runData.gates.length > 0) {
        runData.gates.forEach(gate => {
            if (gate.players && gate.players.length > 0) {
                gate.players.forEach(player => {
                    if (player.skills && player.skills.length > 0) {
                        player.skills.forEach(skill => {
                            if (skill.id > 0) allSkillIds.add(skill.id);
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
    skillDictionary["-1"] = "Basic Attack";

    // --- Step 5: Return the combined data ---
    return {
        runData: runData,
        skillDictionary: skillDictionary
    };
}


// --- FRONTEND HTML CONTENT ---
// This is the full content of the old public/index.html file
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en" class="h-full">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Run Data Fetcher</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {
            font-family: 'Inter', sans-serif;
        }
        #chartContainer {
            position: relative;
            height: 400px;
            width: 100%;
        }
        .loader {
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top: 4px solid #3b82f6;
            width: 32px;
            height: 32px;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
    <script>
        tailwind.config = { darkMode: 'class' }
        document.documentElement.classList.add('dark');
    </script>
</head>
<body class="bg-gray-900 text-gray-100 p-4 md:p-8">
    <div class="max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold text-white mb-6">Run Data Fetcher</h1>
        
        <!-- Input Form -->
        <div class="bg-gray-800 p-6 rounded-lg mb-6">
            <div class="grid grid-cols-1 gap-6">
                
                <!-- Fatduck Run URL -->
                <div>
                    <label for="fatduckUrlInput" class="block text-sm font-medium text-gray-300 mb-2">
                        Fatduck Run URL
                    </label>
                    <input type="text" id="fatduckUrlInput" value="https://fatduckdn.com/runs/776482144628289536" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white">
                </div>

                <!-- Fetch Button -->
                <div class="flex items-end">
                    <button id="fetchDataButton" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg transition-colors">
                        Fetch Run Info
                    </button>
                </div>
            </div>
        </div>

        <!-- Status/Error Output -->
        <div id="statusOutput" class="hidden my-4 p-4 bg-gray-800 rounded-lg text-red-400 font-mono text-sm"></div>
        <div id="loadingIndicator" class="hidden flex justify-center items-center my-6">
            <div class="loader"></div>
            <span class="ml-4 text-gray-300">Fetching data from the API...</span>
        </div>

        <!-- Filters (Hidden until data is fetched) -->
        <div id="filterControls" class="hidden bg-gray-800 p-6 rounded-lg mb-6">
             <h2 class="text-xl font-semibold text-white mb-4">Select Data to Display</h2>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <label for="playerSelect" class="block text-sm font-medium text-gray-300 mb-2">
                        Select Player
                    </label>
                    <select id="playerSelect" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white"></select>
                </div>
                <div>
                    <label for="gateSelect" class="block text-sm font-medium text-gray-300 mb-2">
                        Select Gate
                    </label>
                    <select id="gateSelect" class="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white"></select>
                </div>
                <div class="md:mt-7">
                    <button id="generateJsonButton" class="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors">
                        Generate & Display
                    </button>
                </div>
            </div>
        </div>

        <!-- Output Section (Table + Chart + JSON) -->
        <div id="outputSection" class="hidden">
            <!-- Data Table -->
            <h2 class="text-2xl font-semibold text-white mb-4">Data Table</h2>
            <div class="overflow-x-auto bg-gray-800 rounded-lg shadow mb-8">
                <table class="w-full min-w-max text-sm text-left">
                    <thead class="bg-gray-700 text-gray-300 uppercase text-xs">
                        <tr>
                            <th class="p-3 font-semibold">Skill Name</th>
                            <th class="p-3 font-semibold text-right">Damage</th>
                            <th class="p-3 font-semibold text-right">Percent</th>
                            <th class="p-3 font-semibold text-center">Crit/Hits</th>
                            <th class="p-3 font-semibold text-right">Crit Rate</th>
                        </tr>
                    </thead>
                    <tbody id="outputTableBody" class="divide-y divide-gray-700 text-gray-200"></tbody>
                </table>
            </div>

            <!-- Bar Chart -->
            <h2 class="text-2xl font-semibold text-white mb-4">Skill Damage Spread</h2>
            <div id="chartContainer" class="bg-gray-800 p-4 rounded-lg shadow mb-8">
                <canvas id="damageChart"></canvas>
            </div>

            <!-- JSON Output -->
            <h2 class="text-2xl font-semibold text-white mb-4">Cleaned JSON Output</h2>
            <textarea id="output" rows="15" class="w-full p-3 bg-gray-950 border border-gray-700 rounded-lg text-green-300 text-sm font-mono" readonly></textarea>
        </div>
    </div>

    <script>
        let damageChartInstance = null; // To hold the chart object
        let FULL_RUN_DATA = null;
        let SKILL_DICTIONARY = {};

        function showStatus(message, isError = false) {
            const statusBox = document.getElementById('statusOutput');
            statusBox.classList.remove('hidden');
            statusBox.textContent = message;
            if (isError) {
                statusBox.classList.add('text-red-400');
                statusBox.classList.remove('text-green-400');
            } else {
                statusBox.classList.remove('text-red-400');
                statusBox.classList.add('text-green-400');
            }
        }

        async function fetchRunInfo() {
            const fatduckUrl = document.getElementById('fatduckUrlInput').value.trim();
            const loading = document.getElementById('loadingIndicator');
            const statusBox = document.getElementById('statusOutput');
            const outputSection = document.getElementById('outputSection');
            const filterControls = document.getElementById('filterControls');

            if (!fatduckUrl) {
                showStatus("Please fill in the Fatduck Run URL.", true);
                return;
            }
            
            let runId = '';
            try {
                const urlParts = new URL(fatduckUrl).pathname.split('/');
                runId = urlParts.pop() || urlParts.pop(); 
                if (!/^\\d+$/.test(runId)) {
                    throw new Error("Could not parse Run ID from URL.");
                }
            } catch (e) {
                showStatus(\`Invalid Fatduck URL. Make sure it looks like "https://fatduckdn.com/runs/..."\`, true);
                return;
            }
            
            loading.classList.remove('hidden');
            statusBox.classList.add('hidden');
            outputSection.classList.add('hidden');
            filterControls.classList.add('hidden');

            // THIS IS THE KEY: We fetch from a relative URL.
            // The browser sends the request to /api/get-run-data on the *same domain*,
            // which our Node.js server is handling.
            const apiUrl = \`/api/get-run-data?id=\${runId}\`;

            try {
                const response = await fetch(apiUrl);
                const data = await response.json();
                loading.classList.add('hidden');

                if (!response.ok || data.error) {
                    throw new Error(data.error || \`Request failed with status \${response.status}\`);
                }
                
                FULL_RUN_DATA = data.runData;
                SKILL_DICTIONARY = data.skillDictionary;
                
                populateFilters();
                filterControls.classList.remove('hidden');
                showStatus("Success! Run info loaded. Please select a player and gate.", false);

            } catch (error) {
                loading.classList.add('hidden');
                showStatus(\`Error: \${error.message}. Check your Vercel deployment logs and console for details.\`, true);
            }
        }

        function populateFilters() {
            const playerSelect = document.getElementById('playerSelect');
            const gateSelect = document.getElementById('gateSelect');
            playerSelect.innerHTML = '';
            gateSelect.innerHTML = '';

            FULL_RUN_DATA.players.forEach(player => {
                const option = document.createElement('option');
                option.value = player.id;
                option.textContent = player.name;
                playerSelect.appendChild(option);
            });

            FULL_RUN_DATA.gates.forEach(gate => {
                const option = document.createElement('option');
                option.value = gate.id;
                option.textContent = \`\${gate.gateNum}: \${gate.name}\`;
                gateSelect.appendChild(option);
            });
        }

        function generateCleanJson() {
            const playerId = parseInt(document.getElementById('playerSelect').value, 10);
            const gateId = document.getElementById('gateSelect').value;

            const gate = FULL_RUN_DATA.gates.find(g => g.id === gateId);
            if (!gate) {
                showStatus("Error: Gate data not found.", true);
                return;
            }
            
            const player = gate.players.find(p => p.id === playerId);
            if (!player) {
                showStatus("Error: Player data not found for this gate.", true);
                return;
            }
            
            const totalDamage = parseInt(player.damageDealt.replace(/\\./g, ''), 10);

            if (totalDamage === 0) {
                showStatus("Player has 0 damage for this gate. No data to display.", false);
                document.getElementById('output').value = "[]";
                populateTable([]);
                if (damageChartInstance) damageChartInstance.destroy();
                outputSection.classList.remove('hidden');
                return;
            }
            
            const cleanedData = player.skills.map(skill => {
                const damage = parseInt(skill.damage.replace(/\\./g, ''), 10);
                const percent = parseFloat(((damage / totalDamage) * 100).toFixed(1));
                
                const crits = skill.hitCounts[1] || 0;
                const totalHits = skill.hitCounts.reduce((a, b) => a + b, 0);
                const critHitsStr = \`\${crits} / \${totalHits}\`;
                const critRate = (totalHits > 0) ? parseFloat(((crits / totalHits) * 100).toFixed(1)) : 0.0;
                
                return {
                    name: SKILL_DICTIONARY[skill.id] || \`Unknown Skill (\${skill.id})\`,
                    damage: damage,
                    percent: percent,
                    crit_hits: critHitsStr,
                    crit_rate: critRate
                };
            }).sort((a, b) => b.damage - a.damage);

            document.getElementById('output').value = JSON.stringify(cleanedData, null, 2);
            populateTable(cleanedData);
            populateChart(cleanedData);
            
            outputSection.classList.remove('hidden');
            statusBox.classList.add('hidden');
        }

        function populateTable(data) {
            const tableBody = document.getElementById('outputTableBody');
            tableBody.innerHTML = ''; 

            if (data.length === 0) {
                 tableBody.innerHTML = '<tr><td colspan="5" class="p-3 text-center text-gray-400">No skill data found.</td></tr>';
                 return;
            }

            data.forEach(skill => {
                const row = document.createElement('tr');
                row.className = 'hover:bg-gray-700';
                row.innerHTML = \`
                    <td class_name="p-3">\${skill.name}</td>
                    <td class="p
