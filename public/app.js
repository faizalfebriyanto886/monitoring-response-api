const $ = (id) => document.getElementById(id);

let timer;
let refreshing = false;

async function stats() {
  try {
    const response = await fetch('/api/v1/stats');

    if (!response.ok) {
      console.error('Failed to fetch stats:', response.status);
      return;
    }

    const data = await response.json();

    $('total').textContent = Number(data.total || 0).toLocaleString();
    $('errors').textContent = Number(data.errors || 0).toLocaleString();
    $('avg').textContent = `${data.avgMs || 0} ms`;
  } catch (error) {
    console.error('Stats error:', error);
  }
}

async function logs() {
  try {
    const params = new URLSearchParams({
      limit: '100',
    });

    const search = $('search').value.trim();
    const status = $('status').value;
    const platform = $('platform').value;

    if (search) {
      params.set('search', search);
    }

    if (status) {
      params.set('status', status);
    }

    if (platform) {
      params.set('platform', platform);
    }

    const response = await fetch(`/api/v1/logs?${params.toString()}`);

    if (!response.ok) {
      console.error('Failed to fetch logs:', response.status);
      return;
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      console.error('Invalid logs response:', data);
      return;
    }

    $('rows').innerHTML = data
      .map(
        (item) => `
          <tr data-log-id="${esc(item.id)}">
            <td>
              ${new Date(item.created_at).toLocaleString()}
            </td>

            <td>
              ${esc(item.app_name || '-')}
              <br>
              <small>${esc(item.app_version || '')}</small>
            </td>

            <td>
              ${esc(item.device_model || '-')}
              <br>
              <small>${esc(item.platform || '')}</small>
            </td>

            <td>
              ${esc(item.method || '-')}
            </td>

            <td>
              ${esc(item.endpoint || item.url || '-')}
            </td>

            <td class="${Number(item.status_code) >= 400 ? 'bad' : 'ok'}">
              ${item.status_code ?? '-'}
            </td>

            <td>
              ${item.duration_ms ?? '-'} ms
            </td>
          </tr>
        `,
      )
      .join('');
  } catch (error) {
    console.error('Logs error:', error);
  }
}

async function showDetail(id) {
  try {
    const response = await fetch(`/api/v1/logs/${encodeURIComponent(id)}`);

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    const responseData = await response.json();
    const data = responseData.data ?? responseData;

    $('json').textContent = JSON.stringify(data, null, 2);

    $('detail').showModal();
  } catch (error) {
    console.error('Detail error:', error);
    $('json').textContent = `Unable to load log detail: ${error.message}`;
    $('detail').showModal();
  }
}

function closeDetail() {
  if ($('detail').open) {
    $('detail').close();
  }
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (match) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[match],
  );
}

async function refresh() {
  if (refreshing) return;
  refreshing = true;
  await Promise.all([stats(), logs()]);
  refreshing = false;
}

$('rows').addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-log-id]');

  if (row) {
    showDetail(row.dataset.logId);
  }
});

$('detail-close').addEventListener('click', closeDetail);

$('refresh').addEventListener('click', refresh);

$('search').addEventListener('input', () => {
  clearTimeout(timer);

  timer = setTimeout(() => {
    logs();
  }, 300);
});

$('status').addEventListener('change', logs);

$('platform').addEventListener('change', logs);

$('clear').addEventListener('click', async () => {
  const confirmed = confirm('Delete all logs?');

  if (!confirmed) {
    return;
  }

  try {
    const response = await fetch('/api/v1/logs', {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.error('Failed to delete logs:', response.status);
      return;
    }

    await refresh();
  } catch (error) {
    console.error('Delete logs error:', error);
  }
});

refresh();

// Reduce background reads while keeping the dashboard reasonably fresh.
setInterval(() => {
  if (!document.hidden) refresh();
}, 60000);
