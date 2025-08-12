let sensorMapping = {};
let roomToSensors = {};
const apiBase = `${location.protocol}//${location.hostname}:5000`;
let autoUpdateInterval;
let currentRoomId = null;
let activeCharts = {};

async function fetchRoomSensorMappings() {
    try {
        const mapRes = await fetch(`${apiBase}/room-sensors-map`);
        sensorMapping = await mapRes.json();

        roomToSensors = {};
        for (const [sid, info] of Object.entries(sensorMapping)) {
            const room = info.room_id;
            if (!roomToSensors[room]) roomToSensors[room] = [];
            roomToSensors[room].push({ sensor_id: sid, type: info.type });
        }

        const roomRes = await fetch(`${apiBase}/rooms`);
        const rooms = await roomRes.json();
        const roomList = document.getElementById("roomList");
        roomList.innerHTML = "";
        
        rooms.forEach(r => {
            const roomLink = document.createElement("a");
            roomLink.href = "#";
            roomLink.className = "room-item";
            roomLink.textContent = `Room ${r}`;
            roomLink.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('.room-item').forEach(item => item.classList.remove('active'));
                roomLink.classList.add('active');
                drawChartsForRoom(r, roomToSensors[r]);
            };
            roomList.appendChild(roomLink);
        });
        
        if (roomList.firstChild) {
            roomList.firstChild.click();
        }
    } catch (error) {
        console.error("Failed to fetch initial data:", error);
        document.getElementById("roomTitle").textContent = "Error: Could not connect to API.";
    }
}

async function drawChartsForRoom(roomId, sensors) {
    currentRoomId = roomId;
    document.getElementById("roomTitle").textContent = `Sensor Data - Room ${roomId}`;
    const container = document.getElementById("sensorCharts");
    container.innerHTML = "";
    Object.values(activeCharts).forEach(chart => chart.destroy()); // Destroy old charts
    activeCharts = {};

    // Reset KPIs
    document.getElementById("latestTemp").textContent = '-- C';
    document.getElementById("latestHumidity").textContent = '-- %';
    document.getElementById("latestLight").textContent = '-- lux';

    const types = ["temperature", "humidity", "light"];
    const typeToSensor = {};
    sensors.forEach(s => { typeToSensor[s.type] = s.sensor_id; });

    container.className = `chart-grid item-count-${sensors.length}`;

    const isDarkMode = document.body.classList.contains('dark-mode');
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDarkMode ? '#e0e0e0' : '#333';

    for (const type of types) {
        const sensorId = typeToSensor[type];
        if (!sensorId) continue;

        const card = document.createElement("div");
        card.className = "chart-card";
        const title = document.createElement("h3");
        title.textContent = `${type.charAt(0).toUpperCase() + type.slice(1)} (${sensorId})`;
        const canvas = document.createElement("canvas");
        card.appendChild(title);
        card.appendChild(canvas);
        container.appendChild(card);
        
        try {
            const res = await fetch(`${apiBase}/sensor/${sensorId}/history`);
            const data = await res.json();
            const labels = data.map(d => new Date(d.timestamp * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
            const values = data.map(d => d.value);

            if (values.length > 0) {
                const latestValue = values[values.length - 1];
                if (type === 'temperature') document.getElementById("latestTemp").textContent = `${latestValue} C`;
                if (type === 'humidity') document.getElementById("latestHumidity").textContent = `${latestValue} %`;
                if (type === 'light') document.getElementById("latestLight").textContent = `${latestValue} lux`;
            }

            const ctx = canvas.getContext("2d");
            const chart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: type,
                        data: values,
                        borderColor: getChartColor(type),
                        backgroundColor: getChartGradient(ctx, getChartColor(type)),
                        fill: true,
                        tension: 0.4,
                        pointRadius: 2,
                        pointBackgroundColor: getChartColor(type),
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { 
                        y: { 
                            beginAtZero: false,
                            grid: { color: gridColor },
                            ticks: { color: textColor }
                        },
                        x: {
                            grid: { color: gridColor },
                            ticks: { color: textColor }
                        }
                    }
                }
            });
            activeCharts[sensorId] = chart;
        } catch (err) {
            console.error(`Fetch failed for ${sensorId}:`, err);
            title.textContent += " - Error loading data";
        }
    }
    
    setupAutoUpdate();
}

function getChartColor(type) {
    if (type === 'temperature') return '#ff6384';
    if (type === 'humidity') return '#36a2eb';
    if (type === 'light') return '#ffce56';
    return '#6c757d';
}

function getChartGradient(ctx, color) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, `${color}80`);
    gradient.addColorStop(1, `${color}00`);
    return gradient;
}

async function updateAllCharts() {
    if (!currentRoomId || Object.keys(activeCharts).length === 0) return;

    const fromInput = document.getElementById("fromTime").value;
    const toInput = document.getElementById("toTime").value;
    
    let urlSuffix = '';
    if (fromInput && toInput) {
         urlSuffix = `?from=${Math.floor(new Date(fromInput).getTime() / 1000)}&to=${Math.floor(new Date(toInput).getTime() / 1000)}`;
    } else {
         urlSuffix = ''; // Fetch latest if no range
    }

    for (const sensorId in activeCharts) {
        const chart = activeCharts[sensorId];
        try {
            const res = await fetch(`${apiBase}/sensor/${sensorId}/history${urlSuffix}`);
            const data = await res.json();
            if (data && data.length > 0) {
                chart.data.labels = data.map(d => new Date(d.timestamp * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
                chart.data.datasets[0].data = data.map(d => d.value);
                chart.update('none');

                const latestValue = data[data.length-1].value;
                const sensorType = sensorMapping[sensorId].type;
                if (sensorType === 'temperature') document.getElementById("latestTemp").textContent = `${latestValue} C`;
                if (sensorType === 'humidity') document.getElementById("latestHumidity").textContent = `${latestValue} %`;
                if (sensorType === 'light') document.getElementById("latestLight").textContent = `${latestValue} lux`;
            }
        } catch (err) {
            console.error(`Update failed for ${sensorId}:`, err);
        }
    }
}

function updateChart() {
    updateAllCharts();
}

function loadCurrent() {
    document.getElementById('fromTime').value = '';
    document.getElementById('toTime').value = '';
    drawChartsForRoom(currentRoomId, roomToSensors[currentRoomId]);
}

function toggleAutoUpdate(isChecked) {
    if (isChecked) {
        setupAutoUpdate();
    } else {
        clearInterval(autoUpdateInterval);
    }
}

function setupAutoUpdate() {
    clearInterval(autoUpdateInterval);
    const toggle = document.getElementById('autoUpdateToggle');
    if (toggle.checked) {
        const intervalSeconds = parseInt(document.getElementById('intervalInput').value) || 5;
        autoUpdateInterval = setInterval(updateAllCharts, intervalSeconds * 1000);
    }
}

// Function for dark mode to call
function redrawChartsForThemeChange() {
    if (currentRoomId) {
        drawChartsForRoom(currentRoomId, roomToSensors[currentRoomId]);
    }
}

// Initial fetch
document.addEventListener('DOMContentLoaded', fetchRoomSensorMappings);