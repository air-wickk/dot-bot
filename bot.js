// node bot.js to run
const monitorColor = require('./monitorColor');
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, SlashCommandBuilder, ActivityType, Options } = require('discord.js');
const express = require('express');
const ColorDetector = require('./ColorDetector');
require('dotenv').config();

// Load environment variables
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TEST_CHANNEL_ID = process.env.DISCORD_TEST_CHANNEL_ID;
const BLUE_ROLE_ID = process.env.BLUE_ROLE_ID;

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    makeCache: Options.cacheWithLimits({
        MessageManager: 0, // No message cache
    }),
});

// Express server for Render compatibility
const app = express();

// Simple health check endpoint
app.get('/', (req, res) => {
    res.send('Bot is running');
});

// Set the port to listen on
const port = process.env.PORT || 10000;
app.listen(port, () => {
    console.log(`Web service listening on port ${port}`);
});

// Instantiate the ColorDetector
const colorDetector = new ColorDetector();

let browser = null; // Declare browser globally
let page = null; // Declare page globally

// Define launchBrowser outside of monitorColor
async function launchBrowser() {
    try {
        if (browser) await browser.close(); // Close existing browser if any
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage'
            ],
            protocolTimeout: 60000
        });
        page = await browser.newPage();

        global.page = page;
        global.browser = browser;

        await page.setViewport({
            width: 400,
            height: 300,
        });

        await page.setDefaultNavigationTimeout(60000);
        await page.goto('https://global-mind.org/gcpdot/gcp.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.readyState === 'complete', { timeout: 30000 });
    } catch (error) {
        console.error('Error launching browser:', error.message);
        console.log('Retrying browser launch...');
        await new Promise(r => setTimeout(r, 5000));
        await launchBrowser();
    }
}

// Function to get the center color of the screenshot
async function getCenterColor(page, retries = 3) {
    try {
        if (!browser || !page || page.isClosed()) {
            console.warn('Browser or page is not valid. Relaunching...');
            await launchBrowser();
        }

        let screenshot;

        for (let i = 0; i < retries; i++) {
            try {
                const isPageOk = await page.evaluate(() => document.readyState === 'complete');
                if (!isPageOk) {
                    console.warn('Page not fully loaded. Reloading...');
                    await page.reload({ waitUntil: 'load' });
                    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 30000 });
                }

                if (page.isClosed()) throw new Error('Page is closed or detached.');

                await new Promise(r => setTimeout(r, 2000));
                screenshot = await page.screenshot({
                    clip: { x: 0, y: 0, width: 300, height: 300 },
                    encoding: 'base64',
                    timeout: 60000,
                });

                if (screenshot) break;
            } catch (error) {
                console.warn(`Retry ${i + 1}: Failed to take screenshot`, error.message);
                if (i === retries - 1) {
                    console.error('Persistent failure detected. Restarting browser...');
                    await launchBrowser(); // Restart the browser
                    throw error; // Re-throw the error to handle it in the calling function
                }
                await new Promise(res => setTimeout(res, 2000));
            }
        }

        if (!screenshot) {
            console.error('Failed to capture screenshot after retries.');
            return null;
        }

        const color = await page.evaluate((screenshot) => {
            return new Promise((resolve, reject) => {
                try {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + screenshot;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        const pixel = ctx.getImageData(
                            Math.floor(canvas.width / 2),
                            Math.floor(canvas.height / 2),
                            1,
                            1
                        ).data;
                        resolve([pixel[0], pixel[1], pixel[2]]);
                    };
                    img.onerror = () => reject(new Error('Failed to load image onto canvas'));
                } catch (err) {
                    reject(err);
                }
            });
        }, screenshot);

        return colorDetector.classifyColor(color[0], color[1], color[2]); // Use ColorDetector for classification

    } catch (error) {
        console.error('Error in getCenterColor:', error.message);
        return null;
    }
}

// Restart Puppeteer every 45 minutes to free memory
setInterval(async () => {
    console.log('Restarting Puppeteer to free up memory...');
    if (browser) {
        try {
            await browser.close();
        } catch (e) {
            console.warn('Error closing browser during scheduled restart:', e.message);
        }
    }
    await launchBrowser();
}, 45 * 60 * 1000); // 45 minutes

// Log memory usage every 10 minutes
setInterval(() => {
    const mem = process.memoryUsage();
    console.log(`Memory: RSS ${(mem.rss/1024/1024).toFixed(1)}MB, Heap ${(mem.heapUsed/1024/1024).toFixed(1)}MB`);
}, 10 * 60 * 1000);

// 🗨️ Commands
client.on('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);

    await client.application.commands.create(
        new SlashCommandBuilder().setName('dotcolor').setDescription('Get the current color of the dot!')
    );

    monitorColor({
        launchBrowser,
        getCenterColor,
        colorDetector,
        client,
        CHANNEL_ID,
        BLUE_ROLE_ID
    });
});

client.on('messageCreate', async (message) => {
    if (message.content.startsWith('!dotlog')) {
        const args = message.content.split(' '); // Split the command into arguments
        const numEntries = args[1] ? parseInt(args[1]) : 15; // Get the number of entries to display (default is 20)

        if (isNaN(numEntries) || numEntries <= 0) {
            return message.channel.send("Please specify a valid number of entries.");
        }

        // Get the most recent `numEntries` from the color log
        const recentColors = colorDetector.getColorLog().slice(-numEntries); // Use ColorDetector for log retrieval
        if (recentColors.length === 0) {
            return message.channel.send("📭 **The color log is empty.**");
        }

        // Format the color log entries with colors and relative timestamps
        const colorLogMessages = recentColors.map(entry => {
            const relativeTime = `<t:${Math.floor(entry.timestamp / 1000)}:R>`;
            return `Color: ${entry.color} (${relativeTime})`; // Color and relative time in compact format
        });

        // Join the formatted entries into a single string, separating by ' | '
        const logMessage = `**Last ${numEntries} Color Log Entries:**\n${colorLogMessages.join(" | ")}`;

        // Ensure the message doesn't exceed Discord's character limit
        const MAX_MESSAGE_LENGTH = 2000; // Discord's message limit
        if (logMessage.length > MAX_MESSAGE_LENGTH) {
            // Split the message into chunks if it's too long
            const chunks = [];
            let currentChunk = "";
            colorLogMessages.forEach((msg, index) => {
                // Add the message to the current chunk
                if ((currentChunk + msg).length < MAX_MESSAGE_LENGTH) {
                    currentChunk += msg + " | "; // Use pipe to separate entries
                } else {
                    chunks.push(currentChunk.trim()); // Remove trailing pipe and add to chunks
                    currentChunk = msg + " | ";
                }
            });
            chunks.push(currentChunk.trim()); // Add the last chunk

            // Send each chunk separately
            for (const chunk of chunks) {
                await message.channel.send(chunk);
            }
        } else {
            // Send the message if it fits within the limit
            message.channel.send(logMessage);
        }
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'dotcolor') {
        await interaction.reply('🔍 Checking the dot, please wait...');
        const color = colorDetector.getLastColor(); // Use ColorDetector for the last color
        await interaction.editReply(`**The dot is** ${color} **right now**`);
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    if (browser) await browser.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down gracefully...');
    if (browser) await browser.close();
    process.exit(0);
});

client.login(BOT_TOKEN);