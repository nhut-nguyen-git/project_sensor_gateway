// --- DARK MODE LOGIC ---
const darkModeToggle = document.getElementById('darkModeToggle');

// Function to apply saved theme on page load
function applySavedTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
    }
}

if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        
        const isDarkMode = document.body.classList.contains('dark-mode');
        localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');

        // Check if the chart redrawing function exists before calling it
        // This makes the script safe for the admin page
        if (typeof redrawChartsForThemeChange === 'function') {
            redrawChartsForThemeChange();
        }
    });
}

// Apply theme as soon as the document is loaded
document.addEventListener('DOMContentLoaded', applySavedTheme);
//log out
const logoutButton = document.getElementById('logoutButton');
if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        await fetch('/logout', { method: 'POST' });
        window.location.href = 'login.html';
    });
}