const fs = require('fs');
const path = require('path');
const { estimateTokens } = require('./router');

const LOGS_PATH = path.join(__dirname, 'data', 'logs.json');

/**
 * Calculates pricing, telemetry and appends to the log tracking system.
 */
function logExecution(routingResult, executionResult, originalText, preprocessedText, config) {
  try {
    const models = config.models;
    const tier = routingResult.routedTier;
    const pricing = models[tier];
    const frontierPricing = models.frontier;

    // Calculate actual token counts
    const inTokens = routingResult.signals.tokenCount; // token count evaluated
    const outTokens = estimateTokens(executionResult.text);

    // Dynamic cost mappings
    const inputCost = (inTokens / 1000000) * pricing.inputCostPerMillion;
    const outputCost = (outTokens / 1000000) * pricing.outputCostPerMillion;
    const totalCost = inputCost + outputCost;

    // Estimate frontier-only baseline cost (original prompt size sent directly to frontier model)
    const originalTokens = estimateTokens(originalText);
    const frontierInCost = (originalTokens / 1000000) * frontierPricing.inputCostPerMillion;
    const frontierOutCost = (outTokens / 1000000) * frontierPricing.outputCostPerMillion;
    const frontierOnlyCost = frontierInCost + frontierOutCost;

    // Calculate savings
    const savings = frontierOnlyCost - totalCost;
    const savingPercent = originalTokens > 0 
      ? parseFloat(((1 - (inTokens / originalTokens)) * 100).toFixed(2)) 
      : 0;

    const logEntry = {
      id: `req-${Date.now()}`,
      timestamp: new Date().toISOString(),
      originalPrompt: originalText,
      preprocessedPrompt: preprocessedText,
      originalTokenCount: originalTokens,
      preprocessedTokenCount: inTokens,
      savingPercent: savingPercent,
      signals: {
        tokenCount: inTokens,
        taskType: routingResult.signals.taskType,
        explicitTags: routingResult.signals.explicitTags,
        hasCode: routingResult.signals.hasCode,
        costCap: routingResult.signals.costCap
      },
      routedTier: tier,
      modelUsed: routingResult.modelName,
      inputCost: parseFloat(inputCost.toFixed(8)),
      outputCost: parseFloat(outputCost.toFixed(8)),
      totalCost: parseFloat(totalCost.toFixed(8)),
      frontierOnlyCost: parseFloat(frontierOnlyCost.toFixed(8)),
      savings: parseFloat(savings.toFixed(8)),
      latencyMs: executionResult.latencyMs,
      status: "success",
      downgradeReason: routingResult.downgradeReason || undefined,
      tagOverrideReason: routingResult.tagOverrideReason || undefined,
      isSimulated: executionResult.isSimulated
    };

    // Load logs, append new entry, and save
    let logs = [];
    if (fs.existsSync(LOGS_PATH)) {
      try {
        const fileContent = fs.readFileSync(LOGS_PATH, 'utf8');
        logs = JSON.parse(fileContent || '[]');
      } catch (err) {
        console.warn('Could not parse logs.json, initializing empty array');
      }
    }

    logs.unshift(logEntry); // new logs at the top
    
    // Cap at 200 logs to prevent file bloating
    if (logs.length > 200) {
      logs = logs.slice(0, 200);
    }

    fs.writeFileSync(LOGS_PATH, JSON.stringify(logs, null, 2), 'utf8');
    return logEntry;

  } catch (err) {
    console.error('Error logging execution telemetry:', err);
    return null;
  }
}

module.exports = {
  logExecution
};
