const fetch = require('node-fetch');

module.exports = async (context) => {
  const { client, m, text } = context;

  try {
    const encodedText = encodeURIComponent(text);
    const apiUrl = `https://api.privatezia.biz.id/api/ai/GPT-4?query=${encodedText}`;
    
    const response = await fetch(apiUrl, { 
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.status || !data.response) {
      return await client.sendMessage(m.chat, { 
        text: `❌ No response from AI, try again!` 
      }, { quoted: m });
    }

    await client.sendMessage(m.chat, { 
      text: `${data.response}\n\n> 🤖 Powered by TamTech-GPT` 
    }, { quoted: m });

  } catch (error) {
    await client.sendMessage(m.chat, { 
      text: `❌ Error: ${error.message}` 
    }, { quoted: m });
  }
};