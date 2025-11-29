// Check if user is authenticated and show dashboard
async function checkAuth() {
  try {
    const response = await fetch('/api/installations');
    if (response.ok) {
      const data = await response.json();
      if (data.installations && data.installations.length > 0) {
        // User has installations, could show dashboard
        console.log('Installations:', data.installations);
      }
    }
  } catch (error) {
    console.log('Not authenticated');
  }
}

checkAuth();
