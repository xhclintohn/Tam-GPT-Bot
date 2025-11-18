const axios = require('axios');
const FormData = require('form-data');

module.exports = async (context) => {
  const { client, m, text } = context;

  try {
    let imageMsg = m;
    let prompt = text || "Describe this image in detail";

    // Handle quoted images
    if (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.quotedMessage) {
      imageMsg = {
        ...m,
        message: m.message.extendedTextMessage.contextInfo.quotedMessage
      };
    }

    // Download image
    const mediaBuffer = await client.downloadMediaMessage(imageMsg);

    // Upload to image host
    const form = new FormData();
    form.append("files[]", mediaBuffer, { filename: 'image.jpg' });

    const upload = await axios.post("https://qu.ax/upload.php", form, {
      headers: form.getHeaders(),
      timeout: 30000
    });

    const uploadedURL = upload.data?.files?.[0]?.url;
    if (!uploadedURL) {
      throw new Error('Image upload failed');
    }

    // Vision API
    const api = `https://api.ootaizumi.web.id/ai/gptnano?prompt=${encodeURIComponent(prompt)}&imageUrl=${encodeURIComponent(uploadedURL)}`;
    const result = await axios.get(api, { timeout: 30000 });

    if (result.data?.result) {
      await client.sendMessage(m.chat, {
        text: `🔍 *Vision Analysis*\n\n${result.data.result}\n\n> 🤖 Powered by TamTech-GPT`
      }, { quoted: m });
    } else {
      throw new Error('No analysis result');
    }

  } catch (error) {
    await client.sendMessage(m.chat, { 
      text: `❌ Vision Error: ${error.message}` 
    }, { quoted: m });
  }
};