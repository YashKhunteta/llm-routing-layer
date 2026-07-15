document.addEventListener('DOMContentLoaded', () => {
  // Global State
  let configState = null;
  let templatesList = [];
  let executionLogs = [];
  
  // Chart references
  let savingsChart = null;
  let distributionChart = null;
  let tokenChart = null;
  let latencyChart = null;

  // Initialize Lucide Icons
  lucide.createIcons();

  // Tab Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const tabContents = document.querySelectorAll('.tab-content');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');

  const tabMeta = {
    playground: { title: 'Developer Playground', subtitle: 'Simulate or run real prompts through the preprocessor & router pipeline.' },
    analytics: { title: 'Analytics & Savings Telemetry', subtitle: 'View performance logs, cost reductions, token summaries, and model splits.' },
    templates: { title: 'Structured Prompt Templates', subtitle: 'Manage server-side Markdown prompts that reduce client-to-router token load.' },
    rules: { title: 'Routing Rules & Pricing Config', subtitle: 'Define token thresholds, complexity flags, cost caps, and model rates.' }
  };

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.getAttribute('data-tab');
      
      // Update sidebar active status
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Update tab contents view
      tabContents.forEach(content => content.classList.remove('active'));
      document.getElementById(`tab-${tab}`).classList.add('active');
      
      // Update Page Headers
      pageTitle.textContent = tabMeta[tab].title;
      pageSubtitle.textContent = tabMeta[tab].subtitle;

      // Handle Tab Specific Initialization
      if (tab === 'analytics') {
        fetchLogsAndRenderDashboard();
      } else if (tab === 'templates') {
        loadTemplatesTab();
      } else if (tab === 'rules') {
        loadConfigRulesTab();
      }
    });
  });

  // Prompt Character and Token Estimator
  const promptTextarea = document.getElementById('playground-prompt');
  const inputTokenCounter = document.getElementById('input-token-counter');

  function updateTokenEstimate() {
    const text = promptTextarea.value || '';
    const chars = text.length;
    const tokens = Math.ceil(chars / 4);
    inputTokenCounter.textContent = `${chars} chars (~${tokens} tokens)`;
  }
  promptTextarea.addEventListener('input', updateTokenEstimate);

  // Chat History Toggle
  const toggleHistoryBtn = document.getElementById('toggle-history');
  const historyContent = document.getElementById('history-content');
  
  toggleHistoryBtn.addEventListener('click', () => {
    const isHidden = historyContent.classList.contains('hidden');
    if (isHidden) {
      historyContent.classList.remove('hidden');
      toggleHistoryBtn.classList.add('open');
    } else {
      historyContent.classList.add('hidden');
      toggleHistoryBtn.classList.remove('open');
    }
  });

  // Chat History Manager
  const historyList = document.getElementById('chat-history-list');
  const addHistoryBtn = document.getElementById('btn-add-history');

  addHistoryBtn.addEventListener('click', () => {
    const turnDiv = document.createElement('div');
    turnDiv.className = 'history-turn';
    turnDiv.innerHTML = `
      <select class="form-control history-role">
        <option value="user">User</option>
        <option value="assistant">Assistant</option>
        <option value="system">System</option>
      </select>
      <textarea class="form-control history-text text-mono" rows="2" placeholder="Message content..."></textarea>
      <button class="btn btn-danger btn-sm btn-delete-turn"><i data-lucide="trash-2"></i></button>
    `;
    historyList.appendChild(turnDiv);
    
    // Wire up delete button
    turnDiv.querySelector('.btn-delete-turn').addEventListener('click', () => {
      turnDiv.remove();
    });
    
    lucide.createIcons();
  });

  // Load API Keys configuration indicators
  async function loadAPIKeyBadges() {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      configState = data;
      
      // Update header badges if server is actually holding real credentials
      // (For this UI, we can check a mock header indicator or look for process environments if returned by API)
      // Since it's handled in server, we'll read status configurations if they're available.
    } catch (err) {
      console.error('Failed API Config pull:', err);
    }
  }

  // Load configuration details for Settings/Rules Forms
  async function loadConfigRulesTab() {
    try {
      const response = await fetch('/api/config');
      const config = await response.json();
      configState = config;

      // Populate Pricing Forms
      document.getElementById('price-small-name').value = config.models.small.name;
      document.getElementById('price-small-in').value = config.models.small.inputCostPerMillion;
      document.getElementById('price-small-out').value = config.models.small.outputCostPerMillion;

      document.getElementById('price-mid-name').value = config.models.mid.name;
      document.getElementById('price-mid-in').value = config.models.mid.inputCostPerMillion;
      document.getElementById('price-mid-out').value = config.models.mid.outputCostPerMillion;

      document.getElementById('price-frontier-name').value = config.models.frontier.name;
      document.getElementById('price-frontier-in').value = config.models.frontier.inputCostPerMillion;
      document.getElementById('price-frontier-out').value = config.models.frontier.outputCostPerMillion;

      // Populate Routing Logic Forms
      document.getElementById('rules-small-limit').value = config.rules.tokenThresholds.smallLimit;
      document.getElementById('rules-mid-limit').value = config.rules.tokenThresholds.midLimit;
      document.getElementById('rules-keywords').value = config.rules.complexityKeywords.join(', ');
      document.getElementById('rules-max-cost').value = config.rules.costCap.maxCostPerRequest;
      document.getElementById('rules-enforce-downgrade').checked = config.rules.costCap.enforceDowngradeOnCap;

      // Populate Preprocessor checkmarks
      document.getElementById('preproc-whitespace').checked = config.rules.preprocessing.stripWhitespace;
      document.getElementById('preproc-boilerplate').checked = config.rules.preprocessing.stripBoilerplate;
      document.getElementById('preproc-markdown').checked = config.rules.preprocessing.convertToMarkdown;
      document.getElementById('preproc-history').checked = config.rules.preprocessing.compressHistory;

    } catch (err) {
      alert('Error fetching active settings rules: ' + err.message);
    }
  }

  // Save Pricing Settings Form submit handler
  document.getElementById('pricing-config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!configState) return;

    configState.models.small.name = document.getElementById('price-small-name').value;
    configState.models.small.inputCostPerMillion = parseFloat(document.getElementById('price-small-in').value);
    configState.models.small.outputCostPerMillion = parseFloat(document.getElementById('price-small-out').value);

    configState.models.mid.name = document.getElementById('price-mid-name').value;
    configState.models.mid.inputCostPerMillion = parseFloat(document.getElementById('price-mid-in').value);
    configState.models.mid.outputCostPerMillion = parseFloat(document.getElementById('price-mid-out').value);

    configState.models.frontier.name = document.getElementById('price-frontier-name').value;
    configState.models.frontier.inputCostPerMillion = parseFloat(document.getElementById('price-frontier-in').value);
    configState.models.frontier.outputCostPerMillion = parseFloat(document.getElementById('price-frontier-out').value);

    await saveConfigToServer();
  });

  // Save Routing Rules Form submit handler
  document.getElementById('routing-rules-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!configState) return;

    configState.rules.tokenThresholds.smallLimit = parseInt(document.getElementById('rules-small-limit').value, 10);
    configState.rules.tokenThresholds.midLimit = parseInt(document.getElementById('rules-mid-limit').value, 10);
    
    // Parse keywords split by comma
    configState.rules.complexityKeywords = document.getElementById('rules-keywords').value
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    configState.rules.costCap.maxCostPerRequest = parseFloat(document.getElementById('rules-max-cost').value);
    configState.rules.costCap.enforceDowngradeOnCap = document.getElementById('rules-enforce-downgrade').checked;

    configState.rules.preprocessing.stripWhitespace = document.getElementById('preproc-whitespace').checked;
    configState.rules.preprocessing.stripBoilerplate = document.getElementById('preproc-boilerplate').checked;
    configState.rules.preprocessing.convertToMarkdown = document.getElementById('preproc-markdown').checked;
    configState.rules.preprocessing.compressHistory = document.getElementById('preproc-history').checked;

    await saveConfigToServer();
  });

  async function saveConfigToServer() {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configState)
      });
      const data = await response.json();
      if (data.success) {
        alert('Configuration saved successfully!');
        loadAPIKeyBadges(); // reload state
      } else {
        alert('Error saving config: ' + data.error);
      }
    } catch (err) {
      alert('Error connecting to backend: ' + err.message);
    }
  }

  // Load templates on Start
  async function loadTemplatesDropdown() {
    try {
      const response = await fetch('/api/templates');
      templatesList = await response.json();
      
      const dropdown = document.getElementById('playground-template');
      
      // Preserve choice or select default
      const prevVal = dropdown.value;
      dropdown.innerHTML = '<option value="">-- None (Raw Text) --</option>';
      
      templatesList.forEach(tpl => {
        const opt = document.createElement('option');
        opt.value = tpl.id;
        opt.textContent = tpl.name;
        dropdown.appendChild(opt);
      });

      if (prevVal && templatesList.some(t => t.id === prevVal)) {
        dropdown.value = prevVal;
      }
    } catch (err) {
      console.error('Failed loading templates dropdown list:', err);
    }
  }

  // Handle template selection in Playground
  const templateDropdown = document.getElementById('playground-template');
  const variablesContainer = document.getElementById('template-variables-container');
  const dynamicVarsDiv = document.getElementById('dynamic-variable-inputs');
  const promptInputGroup = document.getElementById('prompt-input-group');

  templateDropdown.addEventListener('change', () => {
    const templateId = templateDropdown.value;
    
    if (!templateId) {
      // Show raw text prompt, hide variables
      variablesContainer.classList.add('hidden');
      promptInputGroup.classList.remove('hidden');
      return;
    }

    const tpl = templatesList.find(t => t.id === templateId);
    if (!tpl) return;

    // Hide main raw input text block since template content handles it
    promptInputGroup.classList.add('hidden');
    variablesContainer.classList.remove('hidden');

    // Create dynamic fields for variables
    dynamicVarsDiv.innerHTML = '';
    tpl.variables.forEach(variable => {
      const div = document.createElement('div');
      div.className = 'form-group';
      div.innerHTML = `
        <label for="var-${variable}">${variable}</label>
        <textarea id="var-${variable}" class="form-control text-mono dynamic-variable-field" rows="3" placeholder="Enter value for {{${variable}}}..."></textarea>
      `;
      dynamicVarsDiv.appendChild(div);
    });
  });

  // Clear playground form
  document.getElementById('btn-clear-playground').addEventListener('click', () => {
    promptTextarea.value = '';
    templateDropdown.value = '';
    variablesContainer.classList.add('hidden');
    promptInputGroup.classList.remove('hidden');
    document.getElementById('override-tag').value = '';
    document.getElementById('override-cost-cap').value = '';
    historyList.innerHTML = '';
    updateTokenEstimate();
  });

  // Execute Route pipeline button trigger
  const runRouteBtn = document.getElementById('btn-execute-route');
  const activeFlow = document.getElementById('pipeline-active-flow');
  const idlePlaceholder = document.getElementById('pipeline-idle-placeholder');

  runRouteBtn.addEventListener('click', async () => {
    const promptText = promptTextarea.value;
    const templateId = templateDropdown.value;
    const tagOverride = document.getElementById('override-tag').value;
    const costCapOverride = document.getElementById('override-cost-cap').value;

    // Gather dynamic variables if template is selected
    const variables = {};
    if (templateId) {
      const inputs = dynamicVarsDiv.querySelectorAll('.dynamic-variable-field');
      let missingVal = false;
      inputs.forEach(input => {
        const id = input.id.replace('var-', '');
        variables[id] = input.value;
        if (!input.value.trim()) missingVal = true;
      });

      if (missingVal) {
        alert('Please fill out all template variable fields before executing.');
        return;
      }
    } else {
      if (!promptText.trim()) {
        alert('Please enter a prompt or choose a template.');
        return;
      }
    }

    // Gather history turns
    const messages = [];
    const turnDivs = historyList.querySelectorAll('.history-turn');
    turnDivs.forEach(div => {
      const role = div.querySelector('.history-role').value;
      const text = div.querySelector('.history-text').value;
      if (text.trim()) {
        messages.push({ role, content: text });
      }
    });

    // Disable button, show loader state
    runRouteBtn.disabled = true;
    runRouteBtn.querySelector('span').textContent = 'Routing Query...';

    // Show visual container
    idlePlaceholder.classList.add('hidden');
    activeFlow.classList.remove('hidden');

    // Add active animation layout
    resetPipelineDOM();

    try {
      const payload = {
        prompt: promptText,
        messages,
        options: {
          tags: tagOverride ? [tagOverride] : [],
          costCap: costCapOverride ? parseFloat(costCapOverride) : undefined,
          templateId: templateId || undefined,
          variables: templateId ? variables : undefined
        }
      };

      const response = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error);
      }

      // Populate visual pipeline step by step
      renderPipelineExecution(data);

    } catch (err) {
      alert('Pipeline execution failed: ' + err.message);
      idlePlaceholder.classList.remove('hidden');
      activeFlow.classList.add('hidden');
    } finally {
      runRouteBtn.disabled = false;
      runRouteBtn.querySelector('span').textContent = 'Execute Route Pipeline';
    }
  });

  function resetPipelineDOM() {
    document.querySelectorAll('.pipeline-step').forEach(step => step.classList.remove('active-step'));
    document.getElementById('preproc-diff-original').textContent = 'Analyzing...';
    document.getElementById('preproc-diff-cleaned').textContent = 'Processing...';
    document.getElementById('token-saving-badge').textContent = '-0%';
    document.getElementById('routed-tier-badge').className = 'badge';
    document.getElementById('routed-tier-badge').textContent = 'ROUTING...';
    
    document.getElementById('signal-token-val').textContent = '0 tokens';
    document.getElementById('signal-task-val').textContent = 'Analyzing...';
    document.getElementById('signal-code-val').textContent = 'No';
    document.getElementById('signal-cap-val').textContent = '$0.00';
    
    document.getElementById('notation-tag-override').classList.add('hidden');
    document.getElementById('notation-cost-downgrade').classList.add('hidden');
    
    document.getElementById('selected-model-pill').textContent = 'Pending selection...';
    document.getElementById('execution-response-text').textContent = 'Awaiting response...';
    document.getElementById('latency-badge').textContent = '0ms';
  }

  function renderPipelineExecution(data) {
    const decision = data.routingDecision;
    const telemetry = data.telemetry;
    
    // Step 1: Preprocessor visual update
    const step1 = document.getElementById('step-preprocessing');
    step1.classList.add('active-step');
    document.getElementById('preproc-diff-original').textContent = data.originalPrompt;
    document.getElementById('preproc-diff-cleaned').textContent = data.preprocessedPrompt;
    
    const compressBadge = document.getElementById('token-saving-badge');
    compressBadge.textContent = `-${telemetry.savingPercent}% tokens`;
    if (telemetry.savingPercent > 0) {
      compressBadge.className = 'badge badge-success';
    } else {
      compressBadge.className = 'badge badge-secondary';
    }

    // Step 2: Classifier Router update
    setTimeout(() => {
      const step2 = document.getElementById('step-router');
      step2.classList.add('active-step');
      
      const tierBadge = document.getElementById('routed-tier-badge');
      tierBadge.textContent = decision.routedTier;
      tierBadge.className = `badge badge-${decision.routedTier}`;

      document.getElementById('signal-token-val').textContent = `${decision.signals.tokenCount} tokens`;
      document.getElementById('signal-task-val').textContent = decision.signals.taskType;
      document.getElementById('signal-code-val').textContent = decision.signals.hasCode ? 'Yes' : 'No';
      document.getElementById('signal-cap-val').textContent = decision.signals.costCap ? `$${decision.signals.costCap}` : 'None';

      if (decision.tagOverrideReason) {
        document.getElementById('notation-tag-override').classList.remove('hidden');
        document.getElementById('tag-override-text').textContent = decision.tagOverrideReason;
      }
      if (decision.downgradeReason) {
        document.getElementById('notation-cost-downgrade').classList.remove('hidden');
        document.getElementById('cost-downgrade-text').textContent = decision.downgradeReason;
      }
    }, 400);

    // Step 3: Execution Output update
    setTimeout(() => {
      const step3 = document.getElementById('step-execution');
      step3.classList.add('active-step');

      document.getElementById('latency-badge').textContent = `${telemetry.latencyMs}ms`;
      document.getElementById('sim-badge').textContent = telemetry.isSimulated ? 'simulation mode' : 'live API provider';
      
      const modelPill = document.getElementById('selected-model-pill');
      modelPill.textContent = decision.modelName;
      modelPill.className = `model-badge badge-${decision.routedTier}`;

      document.getElementById('execution-response-text').textContent = data.response;
      step3.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 850);

    // Step 4: Cost Savings Banner update
    setTimeout(() => {
      document.getElementById('cost-actual').textContent = `$${telemetry.totalCost.toFixed(6)}`;
      document.getElementById('cost-frontier').textContent = `$${telemetry.frontierOnlyCost.toFixed(6)}`;
      
      const savingsVal = document.getElementById('savings-dollar-amount');
      if (telemetry.savings > 0) {
        savingsVal.textContent = `+$${telemetry.savings.toFixed(5)}`;
        savingsVal.style.color = 'var(--accent-green)';
      } else {
        savingsVal.textContent = `$${telemetry.savings.toFixed(5)}`;
        savingsVal.style.color = 'var(--text-secondary)';
      }
      document.getElementById('step-savings').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 1200);
  }

  // Fetch telemetry logs and populate metrics panel + graphs
  async function fetchLogsAndRenderDashboard() {
    try {
      const response = await fetch('/api/logs');
      executionLogs = await response.json();
      
      // Calculate overall indicators
      const totalQueries = executionLogs.length;
      let totalSavings = 0;
      let totalLatency = 0;
      let totalCompression = 0;

      executionLogs.forEach(log => {
        totalSavings += log.savings;
        totalLatency += log.latencyMs;
        totalCompression += log.savingPercent;
      });

      const avgCompression = totalQueries > 0 ? (totalCompression / totalQueries).toFixed(1) : 0;
      const avgLatency = totalQueries > 0 ? Math.round(totalLatency / totalQueries) : 0;

      // Populate metrics UI elements
      document.getElementById('metric-total-requests').textContent = totalQueries;
      document.getElementById('metric-total-savings').textContent = `$${totalSavings.toFixed(4)}`;
      document.getElementById('metric-avg-compression').textContent = `${avgCompression}%`;
      document.getElementById('metric-avg-latency').textContent = `${avgLatency}ms`;

      // Render Charts
      renderAnalyticsCharts(executionLogs);

      // Populate Logs Table
      populateLogsTable(executionLogs);

    } catch (err) {
      console.error('Failed loading analytics data:', err);
    }
  }

  // Refresh logs button listener
  document.getElementById('btn-refresh-logs').addEventListener('click', fetchLogsAndRenderDashboard);

  function populateLogsTable(logs) {
    const tableBody = document.getElementById('logs-table-body');
    if (logs.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="9" class="text-center">No logs generated yet. Use the Playground to execute routes!</td></tr>';
      return;
    }

    tableBody.innerHTML = '';
    logs.forEach(log => {
      const tr = document.createElement('tr');
      const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      tr.innerHTML = `
        <td>${time}</td>
        <td>${log.originalTokenCount}</td>
        <td>${log.preprocessedTokenCount} <span class="text-accent text-xs">(-${log.savingPercent}%)</span></td>
        <td><span class="badge badge-${log.routedTier}">${log.routedTier}</span></td>
        <td><strong>$${log.totalCost.toFixed(6)}</strong></td>
        <td><strong>$${log.frontierOnlyCost.toFixed(6)}</strong></td>
        <td style="color: ${log.savings > 0 ? 'var(--accent-green)' : 'var(--text-muted)'}"><strong>+$${log.savings.toFixed(6)}</strong></td>
        <td>${log.latencyMs}ms</td>
        <td><span class="mode-badge" style="font-size:0.6rem; padding:2px 4px">${log.isSimulated ? 'Sim' : 'Live'}</span></td>
      `;
      tableBody.appendChild(tr);
    });
  }

  // Generate analytics graphs via Chart.js integration
  function renderAnalyticsCharts(logs) {
    // 1. Chart: Cumulative savings line plot
    const sortedLogs = [...logs].reverse(); // oldest first
    let cumulativeSum = 0;
    
    const cumulativeSavingsData = sortedLogs.map(log => {
      cumulativeSum += log.savings;
      return {
        x: new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        y: cumulativeSum
      };
    });

    if (savingsChart) savingsChart.destroy();
    const ctxSavings = document.getElementById('chart-savings').getContext('2d');
    savingsChart = new Chart(ctxSavings, {
      type: 'line',
      data: {
        labels: cumulativeSavingsData.map(d => d.x),
        datasets: [{
          label: 'Total Saved ($)',
          data: cumulativeSavingsData.map(d => d.y),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.05)',
          borderWidth: 2,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b' } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b' } }
        }
      }
    });

    // 2. Chart: Model share doughnut chart
    let smallCount = 0, midCount = 0, frontierCount = 0;
    logs.forEach(log => {
      if (log.routedTier === 'small') smallCount++;
      else if (log.routedTier === 'mid') midCount++;
      else if (log.routedTier === 'frontier') frontierCount++;
    });

    if (distributionChart) distributionChart.destroy();
    const ctxDist = document.getElementById('chart-distribution').getContext('2d');
    distributionChart = new Chart(ctxDist, {
      type: 'doughnut',
      data: {
        labels: ['Small/Fast', 'Balanced', 'Frontier'],
        datasets: [{
          data: [smallCount, midCount, frontierCount],
          backgroundColor: ['#10b981', '#06b6d4', '#8b5cf6'],
          borderColor: 'rgba(255,255,255,0.05)',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12 } }
        }
      }
    });

    // 3. Chart: Token compression bar chart (show last 8 logs side-by-side)
    const recentLogs = [...logs].slice(0, 8).reverse();
    const originalTokens = recentLogs.map(l => l.originalTokenCount);
    const preprocessedTokens = recentLogs.map(l => l.preprocessedTokenCount);
    const timeLabels = recentLogs.map((l, i) => `Req ${i + 1}`);

    if (tokenChart) tokenChart.destroy();
    const ctxToken = document.getElementById('chart-token-reduction').getContext('2d');
    tokenChart = new Chart(ctxToken, {
      type: 'bar',
      data: {
        labels: timeLabels,
        datasets: [
          {
            label: 'Original Tokens',
            data: originalTokens,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderColor: 'rgba(255, 255, 255, 0.2)',
            borderWidth: 1
          },
          {
            label: 'Optimized Tokens',
            data: preprocessedTokens,
            backgroundColor: '#3b82f6',
            borderColor: '#2563eb',
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b' } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b' } }
        },
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        }
      }
    });

    // 4. Chart: Latency trends
    const latencies = recentLogs.map(l => l.latencyMs);
    
    if (latencyChart) latencyChart.destroy();
    const ctxLatency = document.getElementById('chart-latency').getContext('2d');
    latencyChart = new Chart(ctxLatency, {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: [{
          label: 'Latency (ms)',
          data: latencies,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointBackgroundColor: '#f59e0b',
          tension: 0.1
        }]
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b' } },
          y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#64748b' } }
        }
      }
    });
  }

  // Load and hydrate templates registry tab
  async function loadTemplatesTab() {
    try {
      const response = await fetch('/api/templates');
      templatesList = await response.json();

      const listContainer = document.getElementById('templates-list-container');
      listContainer.innerHTML = '';

      if (templatesList.length === 0) {
        listContainer.innerHTML = '<div class="text-center text-secondary py-8">No prompt templates loaded. Add one to get started!</div>';
        return;
      }

      templatesList.forEach(tpl => {
        const item = document.createElement('div');
        item.className = 'template-item';
        
        const variablesHTML = tpl.variables.map(v => `<span class="var-pill">${v}</span>`).join(' ');

        item.innerHTML = `
          <div class="template-item-header">
            <div class="template-item-title">
              <i data-lucide="file-text" style="color: var(--accent-blue)"></i>
              <h4>${tpl.name}</h4>
              <span class="badge badge-secondary" style="font-size:0.6rem; text-transform:none">${tpl.id}</span>
            </div>
            <div class="template-item-actions">
              <button class="btn btn-secondary btn-sm btn-load-tpl" data-id="${tpl.id}" title="Test in Playground"><i data-lucide="play"></i> Use</button>
              <button class="btn btn-danger btn-sm btn-delete-tpl" data-id="${tpl.id}"><i data-lucide="trash-2"></i></button>
            </div>
          </div>
          <div class="template-vars-display">${variablesHTML || '<span class="text-xs text-muted">No variables</span>'}</div>
          <pre class="template-preview">${tpl.content}</pre>
        `;

        listContainer.appendChild(item);

        // Delete wire-up
        item.querySelector('.btn-delete-tpl').addEventListener('click', async () => {
          if (confirm(`Are you sure you want to delete template: ${tpl.name}?`)) {
            await deleteTemplate(tpl.id);
          }
        });

        // Use template wire-up
        item.querySelector('.btn-load-tpl').addEventListener('click', () => {
          // Switch to playground tab
          document.querySelector('[data-tab="playground"]').click();
          // Select template
          templateDropdown.value = tpl.id;
          templateDropdown.dispatchEvent(new Event('change'));
        });
      });

      lucide.createIcons();

    } catch (err) {
      console.error('Failed loading templates list:', err);
    }
  }

  // Template Form Submit Handler
  document.getElementById('template-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('template-id').value.trim();
    const name = document.getElementById('template-name').value.trim();
    const rawVars = document.getElementById('template-variables').value;
    const content = document.getElementById('template-content').value;

    const variables = rawVars.split(',').map(v => v.trim()).filter(Boolean);

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, variables, content })
      });
      const data = await response.json();
      if (data.success) {
        alert('Template saved successfully!');
        document.getElementById('template-form').reset();
        await loadTemplatesTab();
        await loadTemplatesDropdown(); // keep playground synced
      } else {
        alert('Error saving template: ' + data.error);
      }
    } catch (err) {
      alert('Error connecting to server: ' + err.message);
    }
  });

  async function deleteTemplate(id) {
    try {
      const response = await fetch(`/api/templates/${id}`, {
        method: 'DELETE'
      });
      const data = await response.json();
      if (data.success) {
        await loadTemplatesTab();
        await loadTemplatesDropdown();
      } else {
        alert('Failed to delete template: ' + data.error);
      }
    } catch (err) {
      alert('Error: ' + err.message);
    }
  }

  // Check Active API Keys periodically
  async function updateAPIKeyBadges() {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      
      // Let's call a mock or check endpoint settings. For the UI demonstration,
      // we'll update the badges if they're configured.
      // In this setup we can look at dynamic server environments. We'll query server environment indicators.
      // (To keep it clean, we've hardcoded Mock/Live in the HTML but can toggle it dynamically based on API configurations)
    } catch(e) {}
  }

  // Start initialization
  loadAPIKeyBadges();
  loadTemplatesDropdown();
  updateTokenEstimate();
});
