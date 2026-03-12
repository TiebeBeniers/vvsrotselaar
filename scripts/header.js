const teamsBtn  = document.getElementById('teamsDropdownBtn');
const teamsMenu = document.getElementById('teamsDropdownMenu');

function openDropdown() {
    teamsMenu.classList.add('open');
    teamsBtn.setAttribute('aria-expanded', 'true');
}
function closeDropdown() {
    teamsMenu.classList.remove('open');
    teamsBtn.setAttribute('aria-expanded', 'false');
}
teamsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    teamsMenu.classList.contains('open') ? closeDropdown() : openDropdown();
});

// Sluit bij klik buiten het menu (desktop)
document.addEventListener('click', (e) => {
    if (!teamsBtn.contains(e.target) && !teamsMenu.contains(e.target)) {
        closeDropdown();
    }
});

        // Sluit bij klik op een teamlink (sluit ook mobiel zijmenu)
teamsMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        closeDropdown();
        document.getElementById('hamburger')?.classList.remove('active');
        document.getElementById('navMenu')?.classList.remove('active');
    });
});