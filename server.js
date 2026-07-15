const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const preprocessor = require('./preprocessor');
const router = require('./router');
const mockProvider = require('./mockProvider');
const responseHandler = require('./responseHandler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');

// Ensure data directory and config file exist (crucial for empty persistent mounts)
const CONFIG_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}
if (!fs.existsSync(CONFIG_PATH)) {
  const defaultConfig = {
    "models": {
      "small": {
        "name": "Gemini 1.5 Flash-Lite (Small/Fast)",
        "inputCostPerMillion": 0.075,
        "outputCostPerMillion": 0.30,
        "description": "Ultra-low cost and latency. Best for summarization, simple extractions, and basic QA."
      },
      "mid": {
        "name": "Gemini 1.5 Flash (Balanced)",
        "inputCostPerMillion": 0.150,
        "outputCostPerMillion": 0.60,
        "description": "High speed, large context window. Best for standard conversation, classification, and multi-document search."
      },
      "frontier": {
        "name": "Gemini 1.5 Pro (Frontier Reasoner)",
        "inputCostPerMillion": 1.250,
        "outputCostPerMillion": 5.00,
        "description": "State-of-the-art logical reasoning, software engineering, and complex math."
      }
    },
    "rules": {
      "tokenThresholds": {
        "smallLimit": 1500,
        "midLimit": 6000
      },
      "complexityKeywords": [
        "refactor", "implement", "optimize", "architecture", "compile", "bug", "algorithm", "design pattern", 
        "database schema", "concurrency", "regex", "mathematical", "differential", "proof", "derivation", 
        "evaluate complexity", "deep analysis", "compare frameworks", "system design"
      ],
      "explicitTags": {
        "fast": "small",
        "cheap": "small",
        "creative": "mid",
        "accurate": "frontier",
        "reasoning": "frontier",
        "code": "frontier"
      },
      "costCap": {
        "maxCostPerRequest": 0.02,
        "enforceDowngradeOnCap": true
      },
      "preprocessing": {
        "stripWhitespace": true,
        "stripBoilerplate": true,
        "compressHistory": true,
        "maxHistoryTokens": 2000
      }
    },
    "templates": [
      {
        "id": "summarize",
        "name": "Document Summarization Template",
        "content": "# TASK\nSummarize the following document into a concise executive summary. Highlight core objectives and key takeaways.\n\n# CONSTRAINTS\n- Limit summary to 3 bullet points.\n- Be objective, direct, and professional.\n\n# CONTENT\n{{content}}",
        "variables": ["content"]
      },
      {
        "id": "code_review",
        "name": "Structured Code Review",
        "content": "# SYSTEM\nYou are an expert senior software architect conducting a code review.\n\n# INSTRUCTIONS\nAnalyze the code provided below for potential bugs, memory leaks, performance bottlenecks, and design improvements.\n\n# TARGET CODE\nLanguage: {{language}}\n\n```{{language}}\n{{code}}\n```\n\n# OUTPUT FORMAT\nProvide feedback in these sections:\n- ## Critical Issues\n- ## Performance Details\n- ## Stylistic Recommendations",
        "variables": ["language", "code"]
      }
    ]
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), 'utf8');
}

// Helper to read configuration file
function readConfig() {
  const data = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(data);
}

// Helper to write configuration file
function writeConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Endpoint to route a prompt through the pipeline.
 * Body Schema:
 * {
 *   "prompt": "string",
 *   "messages": [], // optional
 *   "options": {
 *      "tags": [],
 *      "costCap": 0.005,
 *      "templateId": "string",
 *      "variables": {}
 *   }
 * }
 */
app.post('/api/route', async (req, res) => {
  try {
    const { prompt, messages = [], options = {} } = req.body;
    const config = readConfig();
    const rules = config.rules;

    let rawPrompt = prompt || '';
    let hydratedText = rawPrompt;

    // 1. Template Registry Check
    if (options.templateId) {
      try {
        hydratedText = preprocessor.resolveTemplate(options.templateId, options.variables || {}, config.templates);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    let preprocessedPrompt = hydratedText;
    let processedMessages = [...messages];

    // 2. Execute preprocessor steps sequentially if configured
    if (rules.preprocessing.stripWhitespace) {
      preprocessedPrompt = preprocessor.stripWhitespace(preprocessedPrompt);
    }
    if (rules.preprocessing.stripBoilerplate) {
      preprocessedPrompt = preprocessor.stripBoilerplate(preprocessedPrompt);
    }
    if (rules.preprocessing.compressHistory && processedMessages.length > 0) {
      processedMessages = preprocessor.compressHistory(processedMessages, rules.preprocessing.maxHistoryTokens);
    }
    
    // Auto-convert to Markdown format if not using a pre-defined template and auto-markdown is enabled
    // Note: This helps achieve the markdown cost-saving structures.
    const isTemplateUsed = !!options.templateId;
    if (rules.preprocessing.convertToMarkdown && !isTemplateUsed) {
      preprocessedPrompt = preprocessor.convertToMarkdownFormat(preprocessedPrompt);
    }

    // 3. Classify and Route Decision
    const routingResult = router.classifyAndRoute(preprocessedPrompt, processedMessages, options);

    // 4. Model Execution (Simulated or Real)
    const executionResult = await mockProvider.executeLLM(
      routingResult.routedTier, 
      routingResult.cleanedText, // Text without inline routing brackets
      routingResult.signals.taskType
    );

    // 5. Logging and Telemetry
    const logEntry = responseHandler.logExecution(
      routingResult, 
      executionResult, 
      hydratedText, // baseline text sent by user or resolved from template
      preprocessedPrompt, 
      config
    );

    res.json({
      success: true,
      originalPrompt: hydratedText,
      preprocessedPrompt: preprocessedPrompt,
      routingDecision: {
        routedTier: routingResult.routedTier,
        modelName: routingResult.modelName,
        signals: routingResult.signals,
        tagOverrideReason: routingResult.tagOverrideReason,
        downgradeReason: routingResult.downgradeReason
      },
      response: executionResult.text,
      telemetry: logEntry
    });

  } catch (err) {
    console.error('Error handling route endpoint:', err);
    res.status(500).json({ error: 'Internal routing error: ' + err.message });
  }
});

/**
 * Get all historical logging telemetry.
 */
app.get('/api/logs', (req, res) => {
  try {
    const LOGS_PATH = path.join(__dirname, 'data', 'logs.json');
    if (fs.existsSync(LOGS_PATH)) {
      const data = fs.readFileSync(LOGS_PATH, 'utf8');
      res.json(JSON.parse(data || '[]'));
    } else {
      res.json([]);
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to read logs: ' + err.message });
  }
});

/**
 * Get active system settings.
 */
app.get('/api/config', (req, res) => {
  try {
    res.json(readConfig());
  } catch (err) {
    res.status(500).json({ error: 'Failed to read configuration: ' + err.message });
  }
});

/**
 * Save updated system rules/settings.
 */
app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || !newConfig.models || !newConfig.rules) {
      return res.status(400).json({ error: 'Invalid configuration format.' });
    }
    writeConfig(newConfig);
    res.json({ success: true, message: 'Configuration updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update configuration: ' + err.message });
  }
});

/**
 * Retrieve Markdown Templates registry.
 */
app.get('/api/templates', (req, res) => {
  try {
    const config = readConfig();
    res.json(config.templates || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve templates: ' + err.message });
  }
});

/**
 * Add / Update templates in dynamic registry.
 */
app.post('/api/templates', (req, res) => {
  try {
    const template = req.body;
    if (!template.id || !template.name || !template.content || !Array.isArray(template.variables)) {
      return res.status(400).json({ error: 'Required fields: id, name, content, variables (array)' });
    }

    const config = readConfig();
    if (!config.templates) config.templates = [];

    const existingIdx = config.templates.findIndex(t => t.id === template.id);
    if (existingIdx !== -1) {
      config.templates[existingIdx] = template; // update
    } else {
      config.templates.push(template); // create new
    }

    writeConfig(config);
    res.json({ success: true, templates: config.templates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save template: ' + err.message });
  }
});

app.delete('/api/templates/:id', (req, res) => {
  try {
    const { id } = req.params;
    const config = readConfig();
    if (!config.templates) return res.status(404).json({ error: 'Templates not found.' });

    const filtered = config.templates.filter(t => t.id !== id);
    config.templates = filtered;
    writeConfig(config);
    res.json({ success: true, templates: config.templates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete template: ' + err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`=============================================================`);
  console.log(`🚀 LLM ROUTING LAYER IS RUNNING ON PORT ${PORT}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  console.log(`⚙️  API Key status:`);
  console.log(`   - Gemini API Key: ${process.env.GEMINI_API_KEY ? '✅ Found' : '❌ Missing (Running in Simulation Mode)'}`);
  console.log(`   - OpenAI API Key: ${process.env.OPENAI_API_KEY ? '✅ Found' : '❌ Missing (Running in Simulation Mode)'}`);
  console.log(`=============================================================`);
});
