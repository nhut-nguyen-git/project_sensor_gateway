(async function() {
    try {
        const response = await fetch('/check-session');
        
        if (!response.ok) {
            // Nếu không có session hợp lệ, đá về trang đăng nhập
            window.location.href = 'login.html';
            return;
        }

        const data = await response.json();
        
        // Phân quyền cho trang admin
        // Lấy tên file hiện tại (ví dụ: "admin.html")
        const currentPage = window.location.pathname.split('/').pop();

        if (currentPage === 'admin.html' && data.role !== 'admin') {
            // Nếu đang ở trang admin nhưng không phải là admin, đá về trang dashboard
            alert('Access Denied: You do not have permission to view this page.');
            window.location.href = 'index.html';
        }

    } catch (error) {
        console.error('Auth check failed:', error);
        // Nếu có lỗi, an toàn nhất là quay về trang đăng nhập
        window.location.href = 'login.html';
    }
})();