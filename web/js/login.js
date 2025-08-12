document.getElementById('loginForm').addEventListener('submit', async function(event) {
    event.preventDefault(); // Ngăn form gửi theo cách truyền thống

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorMessage = document.getElementById('error-message');

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            errorMessage.textContent = '';
            // Đăng nhập thành công, chuyển hướng đến trang dashboard
            window.location.href = 'index.html';
        } else {
            errorMessage.textContent = data.message || 'Login failed.';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorMessage.textContent = 'An error occurred. Please try again.';
    }
	
});