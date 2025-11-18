const { default: makeWASocket, useMultiFileAuthState, fetchLatestWaWebVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

let client = null;

class TamTechBot {
    constructor() {
        this.init();
    }

    async init() {
        try {
            await this.connectToWhatsApp();
        } catch (error) {
            console.error('Init error:', error);
            setTimeout(() => this.init(), 5000);
        }
    }

    async connectToWhatsApp() {
        try {
            const { version } = await fetchLatestWaWebVersion();
            
            // Get session from Heroku env var
            const sessionBase64 = process.env.SESSION_ID;
            if (!sessionBase64) {
                throw new Error('SESSION_ID not found in environment variables');
            }

            // Decode base64 session
            const sessionData = JSON.parse(Buffer.from(sessionBase64, 'base64').toString());
            
            client = makeWASocket({
                printQRInTerminal: false,
                syncFullHistory: false,
                markOnlineOnConnect: false,
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 0,
                keepAliveIntervalMs: 10000,
                generateHighQualityLinkPreview: true,
                version: version,
                browser: ['Ubuntu', 'Chrome', '20.0.04'],
                logger: pino({ level: 'fatal' }),
                auth: {
                    creds: sessionData,
                    keys: makeCacheableSignalKeyStore({}, pino().child({ level: 'fatal', stream: 'store' })),
                }
            });

            client.ev.on('connection.update', this.handleConnectionUpdate);
            client.ev.on('messages.upsert', this.handleMessagesUpsert);

        } catch (error) {
            console.error('Connection error:', error);
            setTimeout(() => this.connectToWhatsApp(), 10000);
        }
    }

    handleConnectionUpdate = (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log('Connection closed. Reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(() => this.connectToWhatsApp(), 5000);
            }
        } else if (connection === 'open') {
            console.log('✅ TamTech-GPT Bot Connected to WhatsApp');
        }
    }

    handleMessagesUpsert = async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) return;

        // Ignore groups - only work in DMs
        if (msg.key.remoteJid.endsWith('@g.us')) return;

        try {
            // Show typing indicator
            await client.sendPresenceUpdate('composing', msg.key.remoteJid);

            const context = {
                client,
                m: msg,
                text: this.getMessageText(msg)
            };

            // Check if message contains image
            const hasImage = msg.message.imageMessage || 
                            (msg.message.extendedTextMessage && 
                             msg.message.extendedTextMessage.contextInfo && 
                             msg.message.extendedTextMessage.contextInfo.quotedMessage && 
                             msg.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage);

            if (hasImage) {
                await require('./vision')(context);
            } 
            // Check if it's text message
            else if (this.getMessageText(msg).trim().length > 0) {
                await require('./gpt')(context);
            }

        } catch (error) {
            console.error('Error:', error);
            await client.sendMessage(msg.key.remoteJid, { 
                text: `❌ Error: ${error.message}` 
            }, { quoted: msg });
        } finally {
            // Stop typing indicator
            await client.sendPresenceUpdate('paused', msg.key.remoteJid);
        }
    }

    getMessageText(msg) {
        return msg.message?.conversation || 
               msg.message?.extendedTextMessage?.text || 
               msg.message?.imageMessage?.caption || '';
    }
}

// Start bot
new TamTechBot();

// Keep alive for Heroku
setInterval(() => {
    if (client) {
        client.sendPresenceUpdate('available');
    }
}, 60000);