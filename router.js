const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'data', 'config.json');

/**
 * Loads configuration file dynamically to respect runtime settings adjustments.
 */
function loadConfig() {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error loading config, using default fallbacks:', err);
    return {
      models: {
        small: { name: "Small Tier", inputCostPerMillion: 0.075, outputCostPerMillion: 0.30 },
        mid: { name: "Mid Tier", inputCostPerMillion: 0.150, outputCostPerMillion: 0.60 },
        frontier: { name: "Frontier Tier", inputCostPerMillion: 1.25, outputCostPerMillion: 5.00 }
      },
      rules: {
        tokenThresholds: { smallLimit: 1500, midLimit: 6000 },
        complexityKeywords: ["refactor", "optimize", "architecture", "algorithm", "math", "proof"],
        explicitTags: { fast: "small", cheap: "small", accurate: "frontier", reasoning: "frontier", code: "frontier" },
        costCap: { maxCostPerRequest: 0.02, enforceDowngradeOnCap: true }
      }
    };
  }
}

/**
 * Helper to estimate tokens based on character length (~4 characters per token).
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Extract inline brackets tags from the prompt (e.g., [fast], [costCap:0.005]).
 */
function extractInlineTags(promptText) {
  const tags = [];
  let costCap = null;
  let cleanedText = promptText;

  // Regular expression to match tags inside brackets, e.g., [fast] or [costCap:0.002]
  const tagRegex = /\[([a-zA-Z0-9.:\-_]+)\]/g;
  let match;

  while ((match = tagRegex.exec(promptText)) !== null) {
    const tagContent = match[1].trim().toLowerCase();
    if (tagContent.startsWith('costcap:')) {
      const capValue = parseFloat(tagContent.split(':')[1]);
      if (!isNaN(capValue)) {
        costCap = capValue;
      }
    } else {
      tags.push(tagContent);
    }
  }

  // Strip extracted tags from the text
  cleanedText = promptText.replace(tagRegex, '').trim();

  return { tags, costCap, cleanedText };
}

/**
 * Classifies a prompt and chooses the best LLM tier based on rules and signals.
 */
function classifyAndRoute(promptText, messages = [], options = {}) {
  const config = loadConfig();
  const rules = config.rules;
  const models = config.models;

  // 1. Extract override tags from either inline text, parameters, or options
  const { tags: inlineTags, costCap: inlineCostCap, cleanedText } = extractInlineTags(promptText);
  
  const explicitTags = [...(options.tags || []), ...inlineTags];
  const activeCostCap = options.costCap !== undefined ? options.costCap : (inlineCostCap !== null ? inlineCostCap : rules.costCap.maxCostPerRequest);

  // Determine token count for evaluation
  let promptToEvaluate = cleanedText;
  let totalTokenCount = estimateTokens(promptToEvaluate);

  if (messages && messages.length > 0) {
    // If chat context, sum up the messages
    totalTokenCount = messages.reduce((acc, msg) => acc + estimateTokens(msg.content), 0);
  }

  // 2. Identify Task Type and Complexity signals
  let taskType = 'general';
  let hasCode = false;
  
  // Code block detection
  if (promptToEvaluate.includes('```') || /`[a-zA-Z_0-9]+`/.test(promptToEvaluate)) {
    hasCode = true;
    taskType = 'code';
  }

  // Keyword check
  const lowercasePrompt = promptToEvaluate.toLowerCase();
  const matchedKeywords = [];
  rules.complexityKeywords.forEach(keyword => {
    if (lowercasePrompt.includes(keyword.toLowerCase())) {
      matchedKeywords.push(keyword);
      // Elevate task type
      if (['refactor', 'implement', 'optimize', 'algorithm', 'bug'].includes(keyword)) {
        taskType = 'code';
      } else if (['math', 'proof', 'differential', 'derivation'].includes(keyword)) {
        taskType = 'reasoning';
      }
    }
  });

  // Evaluate final complexity tier
  let baseTier = 'small';
  
  if (totalTokenCount > rules.tokenThresholds.midLimit) {
    baseTier = 'frontier';
  } else if (totalTokenCount > rules.tokenThresholds.smallLimit) {
    baseTier = 'mid';
  } else if (taskType === 'code' || taskType === 'reasoning') {
    baseTier = 'frontier';
  } else if (matchedKeywords.length >= 3) {
    baseTier = 'mid';
  }

  // 3. Apply Explicit tag overrides (highest baseline priority)
  let routedTier = baseTier;
  let tagOverrideReason = null;

  for (const tag of explicitTags) {
    if (rules.explicitTags[tag]) {
      routedTier = rules.explicitTags[tag];
      tagOverrideReason = `Explicit tag '[${tag}]' overrode default routing to use '${routedTier}' tier.`;
      break;
    }
  }

  // 4. Evaluate Cost Cap (safety constraint - can downgrade models)
  let downgradeReason = null;
  const originalDecision = routedTier;

  if (rules.costCap.enforceDowngradeOnCap && activeCostCap !== null) {
    // Estimate output size: we assume average completion is about 2.5x the prompt size, or 400 tokens
    const estInputTokens = totalTokenCount;
    const estOutputTokens = Math.max(300, Math.ceil(estInputTokens * 0.5)); // heuristic estimation

    const getEstimatedCost = (tier) => {
      const pricing = models[tier];
      const inCost = (estInputTokens / 1000000) * pricing.inputCostPerMillion;
      const outCost = (estOutputTokens / 1000000) * pricing.outputCostPerMillion;
      return inCost + outCost;
    };

    let estCost = getEstimatedCost(routedTier);

    // If estimated cost exceeds budget cap, downgrade progressively
    if (estCost > activeCostCap) {
      if (routedTier === 'frontier') {
        const midCost = getEstimatedCost('mid');
        if (midCost <= activeCostCap) {
          routedTier = 'mid';
          downgradeReason = `Cost cap limit $${activeCostCap} reached. Down-routed Frontier -> Mid (Est. Frontier: $${estCost.toFixed(5)}, Mid: $${midCost.toFixed(5)}).`;
        } else {
          routedTier = 'small';
          const smallCost = getEstimatedCost('small');
          downgradeReason = `Cost cap limit $${activeCostCap} reached. Down-routed Frontier -> Small (Est. Frontier: $${estCost.toFixed(5)}, Small: $${smallCost.toFixed(5)}).`;
        }
      } else if (routedTier === 'mid') {
        routedTier = 'small';
        const smallCost = getEstimatedCost('small');
        downgradeReason = `Cost cap limit $${activeCostCap} reached. Down-routed Mid -> Small (Est. Mid: $${estCost.toFixed(5)}, Small: $${smallCost.toFixed(5)}).`;
      }
    }
  }

  return {
    routedTier,
    originalDecision,
    modelName: models[routedTier].name,
    signals: {
      tokenCount: totalTokenCount,
      taskType,
      explicitTags,
      hasCode,
      matchedKeywords,
      costCap: activeCostCap
    },
    tagOverrideReason,
    downgradeReason,
    cleanedText
  };
}

module.exports = {
  classifyAndRoute,
  estimateTokens
};
