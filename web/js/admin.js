
// === BIẾN TOÀN CỤC ĐỂ QUẢN LÝ TRẠNG THÁI ===
let allLogs = [];
let currentPage = 1;
let currentSearchQuery = '';
let currentLevelFilter = '';
let autoRefreshInterval = null;

// === HÀM CHÍNH ĐỂ TẢI VÀ HIỂN THỊ LOG ===
async function loadLog(page = 1) {
    currentPage = page;
    const searchInput = document.getElementById('searchInput').value;
    currentSearchQuery = searchInput.trim();

    // Xây dựng URL với các tham số
    const url = `/log?page=${currentPage}&search=${encodeURIComponent(currentSearchQuery)}`;

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        
        allLogs = data.logs || [];
        displayLogs(); // Hiển thị log đã lọc từ backend
        updatePaginationControls(data.pagination);

        // Kiểm tra log lỗi để hiển thị thông báo
        const hasError = allLogs.some(log => log.level === 'ERROR');
        if (hasError) {
            showToast('New ERROR detected in system log!', 'error');
        }

    } catch (error) {
        console.error("Failed to load log:", error);
        const logTableBody = document.getElementById('logTableBody');
        logTableBody.innerHTML = `<tr><td colspan="4" class="error">Error loading logs. See console for details.</td></tr>`;
    }
}

function displayLogs() {
    const logTableBody = document.getElementById('logTableBody');
    logTableBody.innerHTML = '';

    // Lọc theo level ở phía client
    const filteredLogs = allLogs.filter(log => {
        return currentLevelFilter === '' || log.level === currentLevelFilter;
    });

    if (filteredLogs.length === 0) {
        logTableBody.innerHTML = `<tr><td colspan="4">No logs match the current criteria.</td></tr>`;
        return;
    }

    filteredLogs.forEach(log => {
        const row = document.createElement('tr');
        row.className = `log-${log.level.toLowerCase()}`;
        row.innerHTML = `
            <td>${log.timestamp}</td>
            <td><span class="log-level">${log.level}</span></td>
            <td>${log.component}</td>
            <td>${log.message}</td>
        `;
        logTableBody.appendChild(row);
    });
}

// === CÁC HÀM XỬ LÝ SỰ KIỆN ===
function searchLogs() {
    loadLog(1); // Luôn bắt đầu từ trang 1 khi tìm kiếm mới
}

function filterLogs() {
    currentLevelFilter = document.getElementById('logLevelFilter').value;
    displayLogs(); // Chỉ cần hiển thị lại, không cần gọi API
}

function toggleAutoRefresh(isChecked) {
    if (isChecked && !autoRefreshInterval) {
        // Bật auto-refresh: gọi loadLog mỗi 5 giây
        loadLog(currentPage); // Tải ngay lập tức
        autoRefreshInterval = setInterval(() => loadLog(currentPage), 5000);
        showToast('Auto-refresh enabled (5s)', 'info');
    } else if (!isChecked && autoRefreshInterval) {
        // Tắt auto-refresh
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        showToast('Auto-refresh disabled', 'info');
    }
}

// === HÀM HỖ TRỢ CHO PHÂN TRANG VÀ THÔNG BÁO ===
function updatePaginationControls(pagination) {
    const controlsContainer = document.getElementById('paginationControls');
    if (!pagination || pagination.total_pages <= 1) {
        controlsContainer.innerHTML = '';
        return;
    }

    const { page, total_pages } = pagination;

    let html = `
        <button onclick="loadLog(1)" ${page === 1 ? 'disabled' : ''}>&laquo; First</button>
        <button onclick="loadLog(${page - 1})" ${page === 1 ? 'disabled' : ''}>&lsaquo; Prev</button>
        <span>Page ${page} of ${total_pages}</span>
        <button onclick="loadLog(${page + 1})" ${page === total_pages ? 'disabled' : ''}>Next &rsaquo;</button>
        <button onclick="loadLog(${total_pages})" ${page === total_pages ? 'disabled' : ''}>Last &raquo;</button>
    `;
    controlsContainer.innerHTML = html;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Tự động xóa sau 4 giây
    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// Hàm runNode của bạn (giữ nguyên)
async function runNode(sensorId) {
    try {
        const response = await fetch('/run-node', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sensor_id: sensorId })
        });
        const result = await response.json();
        if (result.status === 'started') {
            showToast(`Successfully started Node ${sensorId}`, 'success');
        } else {
            throw new Error(result.error || 'Unknown error');
        }
    } catch (error) {
        showToast(`Failed to start Node ${sensorId}: ${error.message}`, 'error');
    }
}


// === KHỞI TẠO VÀ GÁN SỰ KIỆN KHI TRANG TẢI XONG ===
document.addEventListener('DOMContentLoaded', () => {
    // Tải log lần đầu tiên
    loadLog(1);

    // Thêm sự kiện nhấn Enter cho ô tìm kiếm
    const searchInput = document.getElementById('searchInput');
    searchInput.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            searchLogs();
        }
    });
});