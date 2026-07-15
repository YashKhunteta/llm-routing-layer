// Mock and Real LLM service provider integrations
require('dotenv').config();

// Standard simulated responses for different tasks when running in simulation mode
const SIMULATED_RESPONSES = {
  code: {
    small: `// Simple Javascript helper
function formatData(data) {
  return data ? String(data).trim() : '';
}`,
    mid: `// Optimised JS function with validation
function formatData(data) {
  if (data === null || data === undefined) return '';
  if (typeof data === 'object') {
    return JSON.stringify(data);
  }
  return String(data).trim();
}`,
    frontier: `/**
 * Formats raw input data into structured, sanitised string representations.
 * Handles edge cases: null/undefined, nested structures, cyclic objects, and whitespace trimming.
 * 
 * @param {*} data - Raw data input
 * @returns {string} - Formatted and trimmed output
 */
function formatData(data) {
  if (data === null || data === undefined) {
    return '';
  }
  
  try {
    if (typeof data === 'object') {
      // Handle array formatting
      if (Array.isArray(data)) {
        return data.map(item => formatData(item)).filter(Boolean).join(', ');
      }
      // Standard object serialization
      return JSON.stringify(data, (key, value) => {
        if (typeof value === 'function') return value.toString();
        return value;
      });
    }
    
    // Stringify and strip redundant trailing/leading characters
    return String(data).replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '');
  } catch (err) {
    console.error('Formatting error:', err);
    return '[Serialization Error]';
  }
}`
  },
  writing: {
    small: "Here is your text summary. The document highlights cost reduction, prompt markdown optimization, and dynamic classifier routing.",
    mid: "Executive Summary:\n- **Dynamic Model Selection**: Routes queries between Small, Mid, and Frontier tiers dynamically.\n- **Preprocessor Compactor**: Trims spacing and strips conversational boilerplate to reduce input token counts.\n- **Aesthetic Dashboard**: Visualizes execution metrics, latency, and cost savings in real-time.",
    frontier: "# Executive Summary of LLM Routing Layer Architecture\n\nThis architecture establishes a middleware proxy between core applications and LLM providers. By introducing a pipeline that preprocesses prompts (stripping boilerplate, converting to structured markdown, and summarizing history) and dynamically maps queries to appropriate models, applications can reduce API billing by 60-70%.\n\n### Strategic Advantages:\n1. **Automated Cost Control**: Employs real-time token and complexity classifiers alongside hard budget cost caps.\n2. **Boilerplate Reduction**: Strips transactional greetings and empty padding, leading to an immediate 20-40% input token savings.\n3. **Structured Prompt Routing**: Translates inputs into structured Markdown formats, which has been shown to optimize comprehension and latency in LLM reasoning engines."
  },
  general: {
    small: "I've processed your request. The Small Model tier handles simple queries quickly with minimal latency.",
    mid: "I'm the Mid-tier model. I balance logical capacity with moderate pricing. Let me know if you need to run deeper evaluations.",
    frontier: "I am the Frontier Model Tier. I have analyzed your system prompt, contextual parameters, and explicit guidelines. Let's proceed with executing your complex task."
  }
};

/**
 * Simulates a request delay (latency) depending on the selected model tier.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Router interface for executing requests (real or simulated).
 */
async function executeLLM(tier, prompt, taskType = 'general') {
  const startTime = Date.now();
  let resultText = '';
  let isSimulated = true;

  // Choose correct model mappings
  let apiModelName = '';
  if (tier === 'frontier') {
    apiModelName = 'gemini-1.5-pro';
  } else if (tier === 'mid') {
    apiModelName = 'gemini-1.5-flash';
  } else {
    apiModelName = 'gemini-1.5-flash'; // Flash-lite mock or fallback
  }

  // Attempt real API call if keys exist
  if (process.env.GEMINI_API_KEY) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${apiModelName}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1000 }
          })
        }
      );
      
      const data = await response.json();
      if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0]) {
        resultText = data.candidates[0].content.parts[0].text;
        isSimulated = false;
      } else {
        throw new Error(data.error?.message || 'Empty response from Gemini API');
      }
    } catch (err) {
      console.warn('Real Gemini API call failed, falling back to Simulation Mode:', err.message);
    }
  } else if (process.env.OPENAI_API_KEY) {
    try {
      let openAIModel = tier === 'frontier' ? 'gpt-4o' : (tier === 'mid' ? 'gpt-4o-mini' : 'gpt-4o-mini');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: openAIModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 800
        })
      });
      
      const data = await response.json();
      if (data.choices && data.choices[0].message) {
        resultText = data.choices[0].message.content;
        isSimulated = false;
      } else {
        throw new Error(data.error?.message || 'Empty response from OpenAI API');
      }
    } catch (err) {
      console.warn('Real OpenAI API call failed, falling back to Simulation Mode:', err.message);
    }
  }

  // Fallback to Simulation Mode
  if (isSimulated) {
    // Determine simulated delay based on tier
    let delay = 300; // small
    if (tier === 'mid') delay = 750;
    if (tier === 'frontier') delay = 1500;
    
    // Add minor randomized variation
    delay += Math.floor(Math.random() * 200) - 100;
    await sleep(Math.max(100, delay));

    // Resolve prompt category responses
    const category = SIMULATED_RESPONSES[taskType] ? taskType : 'general';
    resultText = SIMULATED_RESPONSES[category][tier] || SIMULATED_RESPONSES.general[tier];
  }

  const elapsedMs = Date.now() - startTime;
  return {
    text: resultText,
    latencyMs: elapsedMs,
    isSimulated
  };
}

module.exports = {
  executeLLM
};
