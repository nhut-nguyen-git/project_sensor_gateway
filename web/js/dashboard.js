// ============================================================================
// Biến toàn cục & Khởi tạo
// ============================================================================
let sensorMapping = {};
let roomToSensors = {};
const apiBase = `${location.protocol}//${location.hostname}:5000`;
let autoUpdateInterval;
let currentRoomId = null;
let activeCharts = {};
let currentViewMode = 'realtime';

document.addEventListener('DOMContentLoaded', fetchRoomSensorMappings);

// ============================================================================
// Hàm khởi tạo và quản lý trạng thái
// ============================================================================
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
            roomLink.dataset.roomId = r;
            roomLink.textContent = `Room ${r}`;
            roomLink.onclick = (e) => {
                e.preventDefault();
                document.querySelectorAll('.room-item').forEach(item => item.classList.remove('active'));
                roomLink.classList.add('active');
                renderContentForCurrentState();
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

function renderContentForCurrentState() {
    const activeRoom = document.querySelector('.room-item.active');
    if (activeRoom) {
        currentRoomId = activeRoom.dataset.roomId;
    } else {
        console.error("No room selected.");
        return;
    }

    if (currentViewMode === 'daily') {
        drawDailyChart();
    } else if (currentViewMode === 'monthly') {
        drawMonthlyChart();
    } else {
        drawRealtimeCharts();
    }
}

// ============================================================================
// Các hàm xử lý sự kiện click nút
// ============================================================================
function loadCurrent() {
    currentViewMode = 'realtime';
    document.getElementById('daily-filter').style.display = 'none';
    document.getElementById('monthly-filter').style.display = 'none';
    renderContentForCurrentState();
}

function viewDailyChart() {
    currentViewMode = 'daily';
    document.getElementById('daily-filter').style.display = 'block';
    document.getElementById('monthly-filter').style.display = 'none';
    clearInterval(autoUpdateInterval);
    renderContentForCurrentState();
}

function viewMonthlyChart() {
    currentViewMode = 'monthly';
    document.getElementById('daily-filter').style.display = 'none';
    document.getElementById('monthly-filter').style.display = 'block';
    clearInterval(autoUpdateInterval);
    renderContentForCurrentState();
}

// ============================================================================
// CÁC HÀM VẼ BIỂU ĐỒ CHI TIẾT
// ============================================================================

// 1. Chế độ REAL-TIME
async function drawRealtimeCharts() {
    if (!currentRoomId) return;
    document.getElementById("roomTitle").textContent = `Real-time (Last 1 Hour) - Room ${currentRoomId}`;
    const container = document.getElementById("sensorCharts");
    container.innerHTML = "";
    Object.values(activeCharts).forEach(chart => chart.destroy());
    activeCharts = {};
    
    // Reset các chỉ số KPI
    document.getElementById("latestTemp").textContent = '-- C';
    document.getElementById("latestHumidity").textContent = '-- %';
    document.getElementById("latestLight").textContent = '-- lux';

    const sensors = roomToSensors[currentRoomId] || [];
    container.className = `chart-grid item-count-${sensors.length}`;
    
    const isDarkMode = document.body.classList.contains('dark-mode');
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDarkMode ? '#e0e0e0' : '#333';
    
    // TÍNH TOÁN THỜI GIAN CHO 1 GIỜ GẦN NHẤT
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
    const fromTs = Math.floor(oneHourAgo.getTime() / 1000);
    const toTs = Math.floor(now.getTime() / 1000);

    for (const sensor of sensors) {
        const { sensor_id, type } = sensor;
        const card = createChartCard(`${type.charAt(0).toUpperCase() + type.slice(1)} (${sensor_id})`, false);
        container.appendChild(card.card);
        
        try {
            // GỌI API VỚI KHOẢNG THỜI GIAN 1 GIỜ
            const res = await fetch(`${apiBase}/sensor/${sensor_id}/history?from=${fromTs}&to=${toTs}`);
            const data = await res.json();
            
            const chartData = data.map(d => ({ x: d.timestamp * 1000, y: d.value }));

            if (chartData.length > 0) {
                const latestValue = chartData[chartData.length - 1].y;
                if (type === 'temperature') document.getElementById("latestTemp").textContent = `${latestValue.toFixed(2)} C`;
                if (type === 'humidity') document.getElementById("latestHumidity").textContent = `${latestValue.toFixed(2)} %`;
                if (type === 'light') document.getElementById("latestLight").textContent = `${latestValue.toFixed(2)} lux`;
            }

            const ctx = card.canvas.getContext("2d");
            activeCharts[sensor_id] = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: type,
                        data: chartData,
                        borderColor: getChartColor(type),
                        backgroundColor: getChartGradient(ctx, getChartColor(type)),
                        fill: true, tension: 0.4, pointRadius: 2
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
                    scales: { 
                        y: { beginAtZero: false, grid: { color: gridColor }, ticks: { color: textColor } },
                        x: { 
                            type: 'time',
                            min: oneHourAgo.valueOf(), // Giới hạn trục X
                            max: now.valueOf(),       // Giới hạn trục X
                            time: { unit: 'minute', tooltipFormat: 'HH:mm:ss', displayFormats: { minute: 'HH:mm' } },
                            grid: { color: gridColor }, ticks: { color: textColor } 
                        }
                    }
                }
            });
        } catch (err) {
            console.error(`Fetch failed for ${sensor_id}:`, err);
            card.title.textContent += " - Error loading data";
        }
    }
    // Kích hoạt tự động cập nhật sau khi đã vẽ xong
    setupAutoUpdate();
}

// 2. Chế độ DAILY TREND
async function drawDailyChart() {
    if (!currentRoomId) return;

    const datePicker = document.getElementById('viewDate');
    let selectedDate;

    if (datePicker.value) {
        // Tách chuỗi YYYY-MM-DD và tạo ngày an toàn theo giờ địa phương
        const [year, month, day] = datePicker.value.split('-').map(Number);
        selectedDate = new Date(year, month - 1, day);
    } else {
        selectedDate = new Date();
    }
    
    // === SỬA LỖI HIỂN THỊ NGÀY (PHƯƠNG PHÁP CUỐI CÙNG) ===
    // Tạo chuỗi YYYY-MM-DD từ các thành phần ngày của giờ địa phương
    const year = selectedDate.getFullYear();
    const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const day = String(selectedDate.getDate()).padStart(2, '0');
    datePicker.value = `${year}-${month}-${day}`;
    // =======================================================

    const startOfDay = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
    
    const fromTs = Math.floor(startOfDay.getTime() / 1000);
    const toTs = Math.floor(endOfDay.getTime() / 1000);

    const sensors = roomToSensors[currentRoomId] || [];
    const container = document.getElementById("sensorCharts");
    container.innerHTML = "";
    Object.values(activeCharts).forEach(chart => chart.destroy());
    activeCharts = {};
    
    document.getElementById("roomTitle").textContent = `Daily Trend for ${startOfDay.toLocaleDateString()} - Room ${currentRoomId}`;
    container.className = `chart-grid item-count-${sensors.length}`;
    
    const isDarkMode = document.body.classList.contains('dark-mode');
    const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDarkMode ? '#e0e0e0' : '#333';

    // Lặp qua các cảm biến và vẽ biểu đồ cho từng loại
    for (const sensor of sensors) {
        const { sensor_id, type } = sensor;
        const units = { temperature: '°C', humidity: '%', light: 'lux' };
        
        const card = createChartCard(`Daily ${type.charAt(0).toUpperCase() + type.slice(1)} Trend`, false);
        container.appendChild(card.card);
        
        try {
            const res = await fetch(`${apiBase}/sensor/${sensor_id}/history?from=${fromTs}&to=${toTs}`);
            const data = await res.json();
            
            if (data.length === 0) {
                card.title.textContent += " - No data";
                continue; // Chuyển sang cảm biến tiếp theo
            }
            
            const chartData = data.map(d => ({ x: d.timestamp * 1000, y: d.value }));
            const ctx = card.canvas.getContext("2d");
            
            activeCharts[sensor_id] = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: `${type} (${units[type] || ''})`,
                        data: chartData,
                        borderColor: getChartColor(type),
                        backgroundColor: getChartGradient(ctx, getChartColor(type)),
                        fill: true,
                        tension: 0.2,
                        pointRadius: 1
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
                            ticks: { color: textColor }, 
                            title: { display: true, text: `Value (${units[type] || ''})`, color: textColor }
                        },
                        x: { 
                            type: 'time',
                            min: startOfDay.valueOf(),
                            max: endOfDay.valueOf(),
                            time: {
                                unit: 'hour', // Hiển thị các mốc giờ chính
                                tooltipFormat: 'HH:mm:ss',
                                displayFormats: {
                                    hour: 'HH:mm'
                                }
                            },
                            grid: { color: gridColor }, 
                            ticks: { color: textColor, major: { enabled: true } },
                            title: { display: true, text: 'Time of Day', color: textColor }
                        }
                    }
                }
            });

        } catch (error) {
            console.error(`Failed to draw daily chart for ${type}:`, error);
            card.title.textContent += " - Error loading data";
        }
    }
}
// 3. Chế độ MONTHLY MIN/MAX
async function drawMonthlyChart() {
    if (!currentRoomId) return;

    const monthPicker = document.getElementById('viewMonth');
    let year, month;
    if (monthPicker.value) {
        [year, month] = monthPicker.value.split('-').map(Number);
    } else {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
        monthPicker.value = `${year}-${String(month).padStart(2, '0')}`;
    }

    const startOfMonth = new Date(year, month - 1, 1);
    const endOfMonth = new Date(year, month, 0, 23, 59, 59);

    const fromTs = Math.floor(startOfMonth.getTime() / 1000);
    const toTs = Math.floor(endOfMonth.getTime() / 1000);
    
    const sensors = roomToSensors[currentRoomId] || [];
    const container = document.getElementById("sensorCharts");
    container.innerHTML = "";
    Object.values(activeCharts).forEach(chart => chart.destroy());
    activeCharts = {};
    
    const monthName = startOfMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    document.getElementById("roomTitle").textContent = `Monthly Min/Max for ${monthName} - Room ${currentRoomId}`;
    
    container.className = `chart-grid item-count-${sensors.length}`;

    for (const sensor of sensors) {
        await drawSingleAggregatedChart(sensor.sensor_id, sensor.type, fromTs, toTs, container);
    }
}

async function drawSingleAggregatedChart(sensorId, type, fromTs, toTs, container) {
    const url = `${apiBase}/sensor/${sensorId}/aggregated?period=daily&from=${fromTs}&to=${toTs}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        
        const units = { temperature: '°C', humidity: '%', light: 'lux' };
        const card = createChartCard(`${type.charAt(0).toUpperCase() + type.slice(1)} Min/Max`, false);
        container.appendChild(card.card);

        if(data.labels.length === 0){
            card.title.textContent += " - No data for this month.";
            return;
        }

        const isDarkMode = document.body.classList.contains('dark-mode');
        const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
        const textColor = isDarkMode ? '#e0e0e0' : '#333';
        
        const ctx = card.canvas.getContext("2d");
        activeCharts[sensorId] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.labels.map(l => l.split('-')[2]),
                datasets: [
                    { label: `Min`, data: data.min_values, backgroundColor: 'rgba(54, 162, 235, 0.7)'},
                    { label: `Max`, data: data.max_values, backgroundColor: 'rgba(255, 99, 132, 0.7)' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: false, grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: `Value (${units[type] || ''})`, color: textColor } },
                    x: { grid: { color: gridColor }, ticks: { color: textColor }, title: { display: true, text: 'Day of Month', color: textColor } }
                }
            }
        });
    } catch (error) {
        console.error(`Failed to draw monthly chart for ${type}:`, error);
    }
}

// ============================================================================
// Các hàm tiện ích và tự động cập nhật
// ============================================================================
function createChartCard(titleText, isFullWidth = false) {
    const card = document.createElement("div");
    card.className = isFullWidth ? "chart-card-full" : "chart-card";
    const title = document.createElement("h3");
    title.textContent = titleText;
    const canvas = document.createElement("canvas");
    card.appendChild(title);
    card.appendChild(canvas);
    return { card, canvas, title };
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

// HÀM MỚI (thay thế cho hàm updateAllCharts cũ)
async function updateAllCharts() {
    if (currentViewMode !== 'realtime' || !currentRoomId) return;

    const sensors = roomToSensors[currentRoomId] || [];
    for (const sensor of sensors) {
        const { sensor_id, type } = sensor;
        const chart = activeCharts[sensor_id];
        if (!chart) continue; // Bỏ qua nếu biểu đồ không tồn tại

        try {
            // Luôn gọi API /latest để lấy điểm dữ liệu mới nhất
            const res = await fetch(`${apiBase}/sensor/${sensor_id}/latest`);
            const data = await res.json();
            
            if (data.timestamp) {
                const newPoint = {
                    x: data.timestamp * 1000,
                    y: data.sensor_value
                };

                const dataset = chart.data.datasets[0].data;
                const lastPoint = dataset.length > 0 ? dataset[dataset.length - 1] : null;

                // Chỉ thêm nếu điểm dữ liệu thực sự mới
                if (!lastPoint || newPoint.x > lastPoint.x) {
                    dataset.push(newPoint);
                    
                    // CẬP NHẬT CỬA SỔ THỜI GIAN 1 GIỜ (HIỆU ỨNG TRƯỢT)
                    const oneHourAgo = new Date().getTime() - (60 * 60 * 1000);
                    chart.options.scales.x.min = oneHourAgo;
                    chart.options.scales.x.max = new Date().getTime(); 
                    
                    // Xóa các điểm dữ liệu cũ hơn 1 giờ
                    while (dataset.length > 0 && dataset[0].x < oneHourAgo) {
                        dataset.shift();
                    }

                    // Cập nhật các chỉ số KPI
                    const latestValue = newPoint.y;
                    if (type === 'temperature') document.getElementById("latestTemp").textContent = `${latestValue.toFixed(2)} C`;
                    if (type === 'humidity') document.getElementById("latestHumidity").textContent = `${latestValue.toFixed(2)} %`;
                    if (type === 'light') document.getElementById("latestLight").textContent = `${latestValue.toFixed(2)} lux`;
                    
                    // Cập nhật biểu đồ mà không có animation giật cục
                    chart.update('quiet');
                }
            }
        } catch (err) {
            console.error(`Update failed for ${sensor_id}:`, err);
        }
    }
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
    if (toggle.checked && currentViewMode === 'realtime') {
        const intervalSeconds = parseInt(document.getElementById('intervalInput').value) || 5;
        autoUpdateInterval = setInterval(() => updateAllCharts(false), intervalSeconds * 1000);
    }
}

function redrawChartsForThemeChange() {
    if (currentRoomId) {
        renderContentForCurrentState();
    }
}