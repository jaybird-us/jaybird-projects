// Settings page JavaScript
let currentInstallationId = null;
let originalSettings = null;
let currentSettings = null;
let hasChanges = false;

// Initialize
async function init() {
  try {
    // Check for checkout result from URL
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('checkout') === 'success') {
      showToast('Subscription activated! Welcome to Pro.', 'success');
      // Clean URL
      window.history.replaceState({}, document.title, '/settings.html');
    } else if (urlParams.get('checkout') === 'canceled') {
      showToast('Checkout canceled', 'info');
      window.history.replaceState({}, document.title, '/settings.html');
    }

    const response = await fetch('/api/installations');
    const data = await response.json();

    if (!data.installations || data.installations.length === 0) {
      document.getElementById('loading').innerHTML = `
        <p>No installations found.</p>
        <p style="margin-top: 1rem;">
          <a href="https://github.com/apps/jaybird-projects" class="btn btn-primary">Install jayBird Projects</a>
        </p>
      `;
      return;
    }

    // If multiple installations, show selector
    if (data.installations.length > 1) {
      const select = document.getElementById('installation-select');
      data.installations.forEach(inst => {
        const option = document.createElement('option');
        option.value = inst.installation_id;
        option.textContent = inst.account_login;
        select.appendChild(option);
      });
      document.getElementById('installation-select-container').style.display = 'block';
      select.addEventListener('change', () => {
        if (select.value) {
          loadInstallation(parseInt(select.value));
        }
      });
      // Load first installation
      select.value = data.installations[0].installation_id;
    }

    // Load first installation
    await loadInstallation(data.installations[0].installation_id);

  } catch (error) {
    console.error('Failed to load installations:', error);
    document.getElementById('loading').innerHTML = 'Failed to load settings. Please try again.';
  }
}

async function loadInstallation(installationId) {
  currentInstallationId = installationId;

  try {
    // Load settings and subscription in parallel
    const [settingsRes, subscriptionRes] = await Promise.all([
      fetch(`/api/installations/${installationId}/settings`),
      fetch(`/api/installations/${installationId}/subscription`)
    ]);

    const settings = await settingsRes.json();
    const subscription = await subscriptionRes.json();

    originalSettings = JSON.parse(JSON.stringify(settings));
    currentSettings = settings;

    // Update subscription UI
    updateSubscriptionUI(subscription);

    // Update tier badge
    const tierBadge = document.getElementById('tier-badge');
    const plan = subscription.plan || 'free';
    tierBadge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
    tierBadge.className = `tier-badge tier-${plan}`;

    // Populate work days (invert weekendDays to get working days)
    const weekendDays = settings.weekendDays || [0, 6];
    for (let i = 0; i < 7; i++) {
      document.getElementById(`day-${i}`).checked = !weekendDays.includes(i);
    }

    // Populate T-shirt sizes
    const sizes = settings.estimateDays || {};
    document.getElementById('size-xs').value = sizes['XS'] || 2;
    document.getElementById('size-s').value = sizes['S'] || 5;
    document.getElementById('size-m').value = sizes['M'] || 10;
    document.getElementById('size-l').value = sizes['L'] || 15;
    document.getElementById('size-xl').value = sizes['XL'] || 25;
    document.getElementById('size-xxl').value = sizes['XXL'] || 40;

    // Populate confidence buffers
    const buffers = settings.confidenceBuffer || {};
    document.getElementById('conf-high').value = buffers['High'] || 0;
    document.getElementById('conf-medium').value = buffers['Medium'] || 2;
    document.getElementById('conf-low').value = buffers['Low'] || 5;

    // Handle holidays (Pro+ only)
    const holidaysCard = document.getElementById('holidays-card');
    if (subscription.plan === 'free') {
      holidaysCard.classList.add('locked');
    } else {
      holidaysCard.classList.remove('locked');
      await loadHolidays();
    }

    // Show content
    document.getElementById('loading').style.display = 'none';
    document.getElementById('content').style.display = 'block';

    // Add change listeners
    addChangeListeners();

  } catch (error) {
    console.error('Failed to load installation:', error);
    showToast('Failed to load settings', 'error');
  }
}

function updateSubscriptionUI(subscription) {
  const card = document.getElementById('subscription-card');
  const planEl = document.getElementById('subscription-plan');
  const detailsEl = document.getElementById('subscription-details');
  const upgradeBtn = document.getElementById('btn-upgrade');
  const manageBtn = document.getElementById('btn-manage');
  const trialBanner = document.getElementById('trial-banner');
  const trialDaysEl = document.getElementById('trial-days-left');

  // Reset classes
  card.classList.remove('pro-active');
  trialBanner.style.display = 'none';

  if (subscription.plan === 'free') {
    planEl.textContent = 'Free Plan';
    detailsEl.textContent = 'Limited to 50 tracked issues. Upgrade to Pro for unlimited issues and more features.';
    upgradeBtn.style.display = 'inline-block';
    upgradeBtn.textContent = 'Start 14-Day Free Trial';
    manageBtn.style.display = 'none';
  } else if (subscription.plan === 'pro') {
    card.classList.add('pro-active');

    if (subscription.trial) {
      planEl.textContent = 'Pro Trial';
      const daysLeft = Math.ceil((new Date(subscription.trialEnd) - new Date()) / (1000 * 60 * 60 * 24));
      detailsEl.textContent = 'Full access to all Pro features during your trial.';
      trialBanner.style.display = 'flex';
      trialDaysEl.textContent = `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left in your trial`;
      upgradeBtn.style.display = 'none';
      manageBtn.style.display = 'inline-block';
      manageBtn.textContent = 'Add Payment Method';
    } else {
      planEl.textContent = 'Pro Plan';
      if (subscription.cancelAtPeriodEnd) {
        const endDate = new Date(subscription.currentPeriodEnd).toLocaleDateString();
        detailsEl.textContent = `Your subscription will end on ${endDate}. Reactivate to keep Pro features.`;
      } else {
        const renewDate = new Date(subscription.currentPeriodEnd).toLocaleDateString();
        detailsEl.textContent = `Renews on ${renewDate}. Unlimited issues and all Pro features.`;
      }
      upgradeBtn.style.display = 'none';
      manageBtn.style.display = 'inline-block';
      manageBtn.textContent = 'Manage Subscription';
    }
  }
}

async function startCheckout() {
  try {
    const res = await fetch(`/api/installations/${currentInstallationId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      const error = await res.json();
      showToast(error.error || 'Failed to start checkout', 'error');
    }
  } catch (error) {
    console.error('Checkout error:', error);
    showToast('Failed to start checkout', 'error');
  }
}

async function openBillingPortal() {
  try {
    const res = await fetch(`/api/installations/${currentInstallationId}/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (res.ok) {
      const { url } = await res.json();
      window.location.href = url;
    } else {
      const error = await res.json();
      showToast(error.error || 'Failed to open billing portal', 'error');
    }
  } catch (error) {
    console.error('Portal error:', error);
    showToast('Failed to open billing portal', 'error');
  }
}

async function loadHolidays() {
  try {
    const res = await fetch(`/api/installations/${currentInstallationId}/holidays`);
    const data = await res.json();

    const list = document.getElementById('holiday-list');
    list.innerHTML = '';

    if (data.holidays && data.holidays.length > 0) {
      data.holidays.forEach(holiday => {
        const item = document.createElement('div');
        item.className = 'holiday-item';
        item.innerHTML = `
          <div>
            <span class="name">${holiday.name || 'Holiday'}</span>
            <span class="date">${formatDate(holiday.date)}</span>
            ${holiday.recurring ? '<span class="recurring">Recurring</span>' : ''}
          </div>
          <button class="btn btn-danger btn-sm" data-date="${holiday.date}">Remove</button>
        `;
        // Add click handler for remove button
        item.querySelector('button').addEventListener('click', function() {
          removeHoliday(this.dataset.date);
        });
        list.appendChild(item);
      });
    } else {
      list.innerHTML = '<p style="color: var(--text-muted); padding: 1rem;">No holidays configured.</p>';
    }
  } catch (error) {
    console.error('Failed to load holidays:', error);
  }
}

function formatDate(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function addChangeListeners() {
  // Work days
  for (let i = 0; i < 7; i++) {
    document.getElementById(`day-${i}`).addEventListener('change', markChanged);
  }

  // T-shirt sizes
  ['xs', 's', 'm', 'l', 'xl', 'xxl'].forEach(size => {
    document.getElementById(`size-${size}`).addEventListener('input', markChanged);
  });

  // Confidence buffers
  ['high', 'medium', 'low'].forEach(level => {
    document.getElementById(`conf-${level}`).addEventListener('input', markChanged);
  });
}

function markChanged() {
  hasChanges = true;
  document.getElementById('save-bar').classList.add('visible');
}

function resetChanges() {
  loadInstallation(currentInstallationId);
  hasChanges = false;
  document.getElementById('save-bar').classList.remove('visible');
}

async function saveSettings() {
  // Collect weekend days (inverse of working days)
  const weekendDays = [];
  for (let i = 0; i < 7; i++) {
    if (!document.getElementById(`day-${i}`).checked) {
      weekendDays.push(i);
    }
  }

  // Collect T-shirt sizes
  const estimateDays = {
    'XS': parseInt(document.getElementById('size-xs').value) || 2,
    'S': parseInt(document.getElementById('size-s').value) || 5,
    'M': parseInt(document.getElementById('size-m').value) || 10,
    'L': parseInt(document.getElementById('size-l').value) || 15,
    'XL': parseInt(document.getElementById('size-xl').value) || 25,
    'XXL': parseInt(document.getElementById('size-xxl').value) || 40
  };

  // Collect confidence buffers
  const confidenceBuffer = {
    'High': parseInt(document.getElementById('conf-high').value) || 0,
    'Medium': parseInt(document.getElementById('conf-medium').value) || 2,
    'Low': parseInt(document.getElementById('conf-low').value) || 5
  };

  const settings = {
    weekendDays,
    estimateDays,
    confidenceBuffer
  };

  try {
    const res = await fetch(`/api/installations/${currentInstallationId}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (res.ok) {
      showToast('Settings saved successfully', 'success');
      hasChanges = false;
      document.getElementById('save-bar').classList.remove('visible');
      originalSettings = { ...currentSettings, ...settings };
    } else {
      const error = await res.json();
      showToast(error.error || 'Failed to save settings', 'error');
    }
  } catch (error) {
    console.error('Failed to save settings:', error);
    showToast('Failed to save settings', 'error');
  }
}

async function addHoliday() {
  const date = document.getElementById('holiday-date').value;
  const name = document.getElementById('holiday-name').value;
  const recurring = document.getElementById('holiday-recurring').checked;

  if (!date) {
    showToast('Please select a date', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/installations/${currentInstallationId}/holidays`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, name, recurring })
    });

    if (res.ok) {
      showToast('Holiday added', 'success');
      document.getElementById('holiday-date').value = '';
      document.getElementById('holiday-name').value = '';
      document.getElementById('holiday-recurring').checked = false;
      await loadHolidays();
    } else {
      const error = await res.json();
      showToast(error.error || 'Failed to add holiday', 'error');
    }
  } catch (error) {
    console.error('Failed to add holiday:', error);
    showToast('Failed to add holiday', 'error');
  }
}

async function removeHoliday(date) {
  if (!confirm('Remove this holiday?')) return;

  try {
    const res = await fetch(`/api/installations/${currentInstallationId}/holidays/${date}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      showToast('Holiday removed', 'success');
      await loadHolidays();
    } else {
      const error = await res.json();
      showToast(error.error || 'Failed to remove holiday', 'error');
    }
  } catch (error) {
    console.error('Failed to remove holiday:', error);
    showToast('Failed to remove holiday', 'error');
  }
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  setTimeout(() => {
    toast.classList.remove('visible');
  }, 3000);
}

// Warn before leaving with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasChanges) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Add click handlers for buttons
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-reset').addEventListener('click', resetChanges);
  document.getElementById('btn-save').addEventListener('click', saveSettings);
  document.getElementById('btn-add-holiday').addEventListener('click', addHoliday);
  document.getElementById('btn-upgrade').addEventListener('click', startCheckout);
  document.getElementById('btn-manage').addEventListener('click', openBillingPortal);

  // Start
  init();
});
