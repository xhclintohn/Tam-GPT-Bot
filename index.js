const {
  default: toxicConnect,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeInMemoryStore,
  downloadContentFromMessage,
  jidDecode,
  makeCacheableSignalKeyStore,
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();
const port = process.env.PORT || 10000;

const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

let client = null;
const sessionName = 'tamtech-gpt-session';

async function startToxic() {
  try {
    const { version } = await fetchLatestWaWebVersion();
    const { saveCreds, state } = await useMultiFileAuthState(sessionName);

    client = toxicConnect({
      printQRInTerminal: false, 
      syncFullHistory: true,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 0,
      keepAliveIntervalMs: 10000, 
      generateHighQualityLinkPreview: true, 
      patchMessageBeforeSending: (message) => { 
        const requiresPatch = !!(
          message.buttonsMessage ||
          message.templateMessage ||
          message.listMessage
        );
        if (requiresPatch) {
          message = {
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadataVersion: 2,
                  deviceListMetadata: {},
                },
                ...message,
              },
            },
          };
        }
        return message;
      },
      version: version,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      logger: pino({ level: 'silent' }),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino().child({ level: 'silent', stream: 'store' })),
      }
    });

    store.bind(client.ev);

    // Set AI presence
    client.updateProfileStatus(`TamTech-GPT Bot 🤖 | AI-Powered Assistant`);

    client.ev.on("messages.upsert", async ({ messages }) => {
      let mek = messages[0];
      if (!mek || !mek.key || !mek.message) return;

      mek.message = Object.keys(mek.message)[0] === "ephemeralMessage" ? mek.message.ephemeralMessage.message : mek.message;

      const remoteJid = mek.key.remoteJid;
      const sender = client.decodeJid(mek.key.participant || mek.key.remoteJid);
      
      // Ignore groups - only work in DMs
      if (remoteJid.endsWith('@g.us')) return;
      
      // Ignore own messages
      if (mek.key.fromMe) return;

      if (remoteJid.endsWith('@s.whatsapp.net')) {
        await client.sendPresenceUpdate("composing", remoteJid);
      }

      try {
        const context = {
          client,
          m: mek,
          text: getMessageText(mek)
        };

        // Check if message contains image
        const hasImage = mek.message.imageMessage || 
                        (mek.message.extendedTextMessage && 
                         mek.message.extendedTextMessage.contextInfo && 
                         mek.message.extendedTextMessage.contextInfo.quotedMessage && 
                         mek.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage);

        if (hasImage) {
          await require('./vision')(context);
        } 
        // Check if it's text message
        else if (getMessageText(mek).trim().length > 0) {
          await require('./gpt')(context);
        }

      } catch (error) {
        console.error('Error:', error);
        await client.sendMessage(remoteJid, { 
          text: `❌ Error: ${error.message}` 
        }, { quoted: mek });
      } finally {
        if (remoteJid.endsWith('@s.whatsapp.net')) {
          await client.sendPresenceUpdate("paused", remoteJid);
        }
      }
    });

    client.decodeJid = (jid) => {
      if (!jid) return jid;
      if (/:\d+@/gi.test(jid)) {
        let decode = jidDecode(jid) || {};
        return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
      } else return jid;
    };

    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const baseReconnectDelay = 5000;

    client.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      const reason = lastDisconnect?.error ? new Boom(lastDisconnect.error).output.statusCode : null;

      if (connection === "open") {
        reconnectAttempts = 0;
        console.log('✅ TamTech-GPT Bot Connected to WhatsApp');
      }

      if (connection === "close") {
        if (reason === DisconnectReason.loggedOut || reason === 401) {
          await fs.rmSync(sessionName, { recursive: true, force: true });
          return startToxic();
        }

        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttempts);
          reconnectAttempts++;
          console.log(`Reconnecting in ${delay/1000} seconds... (Attempt ${reconnectAttempts})`);
          setTimeout(() => startToxic(), delay);
        }
      }
    });

    client.ev.on("creds.update", saveCreds);

    client.downloadMediaMessage = async (message) => {
      let mime = (message.msg || message).mimetype || '';
      let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
      const stream = await downloadContentFromMessage(message, messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
      }
      return buffer;
    };

  } catch (error) {
    console.error('Start error:', error);
    setTimeout(() => startToxic(), 10000);
  }
}

function getMessageText(msg) {
  return msg.message?.conversation || 
         msg.message?.extendedTextMessage?.text || 
         msg.message?.imageMessage?.caption || '';
}

// Express server for Heroku
app.use(express.static('public'));
app.get("/", (req, res) => {
  res.send("TamTech-GPT Bot is running!");
});
app.listen(port, () => console.log(`Server running on port ${port}`));

// Start the bot
startToxic();

module.exports = startToxic;