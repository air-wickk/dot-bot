// node bot.js to run
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, SlashCommandBuilder, ActivityType, REST, Routes } = require('discord.js');
const express = require('express');
const ColorDetector = require('./ColorDetector'); // Import the ColorDetector class
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
    ]
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
    if (browser) await browser.close(); // Close existing browser if any
    browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage'
        ],
        protocolTimeout: 30000
    });
    page = await browser.newPage();
    await page.setDefaultNavigationTimeout(30000); // Timeout for navigation
    await page.goto('https://global-mind.org/gcpdot/gcp.html', { waitUntil: 'networkidle0' });
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
                    await new Promise(r => setTimeout(r, 2000));
                }

                await new Promise(r => setTimeout(r, 2000)); // Stability delay
                screenshot = await page.screenshot({
                    fullPage: true,
                    encoding: 'base64',
                    timeout: 60000,
                });

                if (screenshot) break;
            } catch (error) {
                console.warn(`Retry ${i + 1}: Failed to take screenshot`, error.message);
                if (i === retries - 1) throw error;
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

let lastColor = null; // Tracks the last detected color
let lastBlueNotificationTime = 0; // Tracks the last time a blue notification was sent
const COOLDOWN_PERIOD = 30 * 60 * 1000; // 30 minutes in milliseconds

async function monitorColor() {
    try {
        await launchBrowser();

        setInterval(async () => {
            try {
                if (!browser || !page || page.isClosed()) {
                    console.warn('Browser or page closed. Relaunching...');
                    await launchBrowser();
                }

                const color = await getCenterColor(page);

                if (color) {
                    colorDetector.addToColorLog(color); // Use ColorDetector for logging

                    const colorMap = {
                        '<:red:1324226477268406353>': '🔴',
                        '<:orangered:1324226458465337365>': '🟠',
                        '<:orange:1324226439796621322>': '🟠',
                        '<:yelloworange:1324226423568728074>': '🟡',
                        '<:yellow:1324226408783810603>': '🟡',
                        '<:greenyellow:1324226389859373086>': '🟢',
                        '<:green:1324226357663633508>': '🟢',
                        '<:cyangreen:1324226321253142539>': '🟢',
                        '<:cyan:1324226273794461706>': '🟢',
                        '<:bluecyan:1324224790164144128>': '🔵',
                        '<:darkblue:1324224216651923519>': '🔵',
                        '<:pink:1326324208279490581>': '⚪'
                    };

                    const statusEmoji = colorMap[color] || '⚪';

                    client.user.setPresence({
                        activities: [{ name: `the dot: ${statusEmoji}`, type: ActivityType.Watching }],
                        status: 'online',
                    });

                    if (
                        ['<:darkblue:1324224216651923519>', '<:bluecyan:1324224790164144128>'].includes(color) && // Color is blue
                        (!['<:darkblue:1324224216651923519>', '<:bluecyan:1324224790164144128>'].includes(lastColor)) // Transitioned from non-blue
                    ) {
                        const now = Date.now();

                        // Check cooldown before sending a message
                        if (now - lastBlueNotificationTime > COOLDOWN_PERIOD) {
                            const channel = await client.channels.fetch(CHANNEL_ID);
                            await channel.send({
                                content: `${colorMap[color]} **The dot is blue!**`,
                                allowedMentions: { roles: [BLUE_ROLE_ID] }
                            });

                            console.log(`Notification sent for color: ${color}`);
                            lastBlueNotificationTime = now; // Update the last notification time
                        } else {
                            console.log("The dot turned blue, but cooldown is active.");
                        }
                    }

                    // Update the last detected color
                    lastColor = color;
                }
            } catch (error) {
                console.error('Error in color detection loop:', error);
            }
        }, 15000);

        setInterval(async () => {
            console.log("Restarting browser...");
            await launchBrowser();
        }, 1800000); // Every 30 minutes

    } catch (error) {
        console.error("Error during color monitoring:", error);
    }
}

// 🗨️ Commands
client.on('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);

    // Register new command
    await client.application.commands.create(
        new SlashCommandBuilder().setName('dotcolor').setDescription('Get the current color of the dot!')
    );

    monitorColor();
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

client.login(BOT_TOKEN);