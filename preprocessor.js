const fs = require('fs');
const path = require('path');

// Common filler/greeting words that add token overhead without adding semantic meaning
const FILLER_PATTERNS = [
  /^(hello|hi|hey|greetings|dear AI|bot|assistant)\b/gi,
  /\b(please|could you|can you|would you mind|if you don't mind|help me (to|with)?)\b/gi,
  /\b(thanks so much|thank you very much|thanks|appreciate it|regards|sincerely)\b[.!]*$/gi,
  /\b(can you please|could you please|please write a|please help me write a)\b/gi,
  /\b(i want you to|your task is to|i need you to)\b/gi
];

/**
 * Strips redundant spaces, empty lines, and excessive punctuation.
 */
function stripWhitespace(text) {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, i, arr) => line !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim();
}

/**
 * Removes standard conversational boilerplate / politeness layers to reduce token counts.
 */
function stripBoilerplate(text) {
  if (!text) return '';
  let cleaned = text;
  
  // Clean up starting greetings/politeness
  cleaned = cleaned.replace(/^(hello\s+assistant|hello\s+bot|hello\s+ai|greetings|hello|hi|hey|dear\s+assistant|dear\s+ai|dear\s+bot)[,\s]*/gi, '');
  
  // Clean up request wrappers
  cleaned = cleaned.replace(/^(can you please|could you please|please help me|please|can you|could you|would you mind|help me)\s+(to\s+)?(write|code|create|explain|summarize|translate|solve|do|make)\b/gi, '$3');
  cleaned = cleaned.replace(/^(your task is to|i need you to|i want you to|task:)\s+/gi, '');
  
  // Clean up ending boilerplate
  cleaned = cleaned.replace(/\s*(thank you very much|thanks so much|thanks|thank you|appreciate it|sincerely)[.!]*$/gi, '');
  
  return cleaned.trim();
}

/**
 * Automatically restructures unstructured plain-text prompts into Markdown sections.
 * Studies show markdown structure can lower context interpretation overhead.
 */
function convertToMarkdownFormat(text) {
  if (!text) return '';
  
  // If it's already highly structured (contains Markdown headers or bullet points), leave it
  if (/#+\s+\w+/i.test(text) && text.includes('\n')) {
    return text;
  }

  let task = '';
  let input = '';
  let code = '';
  let codeLang = 'javascript'; // default

  // Check for code blocks
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  const match = codeBlockRegex.exec(text);
  
  if (match) {
    codeLang = match[1] || 'text';
    code = match[2].trim();
    // Remove the code block from the text to parse the rest
    text = text.replace(codeBlockRegex, '').trim();
  }

  // Regex-based heuristic parsing for "Action: Target" structures
  const colonSplitRegex = /^([\s\S]+?)(?::|for|about|following)\s*\n*([\s\S]+)$/i;
  const splitMatch = text.match(colonSplitRegex);

  if (splitMatch) {
    task = splitMatch[1].trim();
    input = splitMatch[2].trim();
  } else {
    // If we can't split easily, check for sentence breaks
    const sentenceBoundary = text.indexOf('.');
    if (sentenceBoundary > 20 && sentenceBoundary < text.length - 10) {
      task = text.substring(0, sentenceBoundary + 1).trim();
      input = text.substring(sentenceBoundary + 1).trim();
    } else {
      task = text;
    }
  }

  // Build the markdown block
  let markdown = `# TASK\n${task}\n`;
  if (input) {
    markdown += `\n# INPUT DATA\n${input}\n`;
  }
  if (code) {
    markdown += `\n# TARGET CODE\n\`\`\`${codeLang}\n${code}\n\`\`\`\n`;
  }

  return markdown.trim();
}

/**
 * Merges variables into server-side prompt templates.
 */
function resolveTemplate(templateId, variables, templatesRegistry) {
  const template = templatesRegistry.find(t => t.id === templateId);
  if (!template) {
    throw new Error(`Template with ID '${templateId}' not found.`);
  }

  let hydratedContent = template.content;
  template.variables.forEach(variable => {
    const val = variables[variable] !== undefined ? variables[variable] : '';
    hydratedContent = hydratedContent.replace(new RegExp(`{{\\s*${variable}\\s*}}`, 'g'), val);
  });

  return hydratedContent;
}

/**
 * Trims or compresses conversation histories to fit a target token budget.
 */
function compressHistory(messages, maxTokensThreshold = 2000) {
  if (!messages || messages.length === 0) return [];
  
  // Approximate tokens: ~4 characters per token
  const getApproxTokens = (msg) => Math.ceil((msg.content || '').length / 4);
  
  let totalTokens = messages.reduce((acc, msg) => acc + getApproxTokens(msg), 0);
  if (totalTokens <= maxTokensThreshold) {
    return messages;
  }

  // Always retain system message if present
  const systemMsg = messages.find(m => m.role === 'system');
  const otherMsgs = messages.filter(m => m.role !== 'system');
  
  let allowedBudget = maxTokensThreshold;
  if (systemMsg) {
    allowedBudget -= getApproxTokens(systemMsg);
  }

  let currentBudgetUsed = 0;
  const selectedMessages = [];

  // Iterate backwards (newest messages first)
  for (let i = otherMsgs.length - 1; i >= 0; i--) {
    const msg = otherMsgs[i];
    const tokens = getApproxTokens(msg);
    if (currentBudgetUsed + tokens <= allowedBudget) {
      selectedMessages.unshift(msg);
      currentBudgetUsed += tokens;
    } else {
      // If a message is too large but is the absolute latest user message, compress it or slice it
      if (i === otherMsgs.length - 1) {
        const slicedContent = msg.content.substring(0, allowedBudget * 4) + '... [TRUNCATED]';
        selectedMessages.unshift({ role: msg.role, content: slicedContent });
        currentBudgetUsed += allowedBudget;
      } else {
        // Compress older messages: create a summary block
        const summaryMsg = {
          role: 'system',
          content: `[Summary of older conversation turns: ${otherMsgs.slice(0, i + 1).length} messages were omitted to conserve memory/costs.]`
        };
        selectedMessages.unshift(summaryMsg);
        break;
      }
    }
  }

  if (systemMsg) {
    selectedMessages.unshift(systemMsg);
  }

  return selectedMessages;
}

module.exports = {
  stripWhitespace,
  stripBoilerplate,
  convertToMarkdownFormat,
  resolveTemplate,
  compressHistory
};
