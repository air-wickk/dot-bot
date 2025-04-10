// node bot.js to run
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, SlashCommandBuilder, ActivityType } = require('discord.js');
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
            protocolTimeout: 60000 // Increase protocol timeout to 60 seconds
        });
        page = await browser.newPage();

        // Set a smaller viewport size
        await page.setViewport({
            width: 400, // Smaller width
            height: 300, // Smaller height
        });

        await page.setDefaultNavigationTimeout(60000); // Increase navigation timeout to 60 seconds
        await page.goto('https://global-mind.org/gcpdot/gcp.html', { waitUntil: 'domcontentloaded' });
    } catch (error) {
        console.error('Error launching browser:', error.message);
        console.log('Retrying browser launch...');
        await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds before retrying
        await launchBrowser(); // Retry launching the browser
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
                    await new Promise(r => setTimeout(r, 2000));
                }

                if (page.isClosed()) throw new Error('Page is closed or detached.');

                await new Promise(r => setTimeout(r, 2000)); // Stability delay
                screenshot = await page.screenshot({
                    fullPage: true,
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

let lastColor = null; // Tracks the last detected color
let lastBlueNotificationTime = 0; // Tracks the last time a blue notification was sent
const COOLDOWN_PERIOD = 30 * 60 * 1000; // 30 minutes in milliseconds
let lastNotificationMessage = null; // Track the last notification message
let isEditingMessage = false; // Track if the bot is currently editing a message

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

                    // Map for activity status (uses default emojis)
                    const activityStatusMap = {
                        '<:red:1324226477268406353>': '🔴',
                        '<:orangered:1324226458465337365>': '🟠',
                        '<:orange:1324226439796621322>': '🟠',
                        '<:yelloworange:1324226423568728074>': '🟡',
                        '<:yellow:1324226408783810603>': '🟡',
                        '<:greenyellow:1324226389859373086>': '🟢',
                        '<:green:1324226357663633508>': '🟢',
                        '<:cyangreen:1324226321253142539>': '🟢',
                        '<:cyan:1324226273794461706>': '🔵',
                        '<:bluecyan:1324224790164144128>': '🔵',
                        '<:darkblue:1324224216651923519>': '🔵',
                    };

                    // Map for message content (uses words)
                    const messageContentMap = {
                        '<:red:1324226477268406353>': 'red',
                        '<:orangered:1324226458465337365>': 'orange-red',
                        '<:orange:1324226439796621322>': 'orange',
                        '<:yelloworange:1324226423568728074>': 'yellow-orange',
                        '<:yellow:1324226408783810603>': 'yellow',
                        '<:greenyellow:1324226389859373086>': 'green-yellow',
                        '<:green:1324226357663633508>': 'green',
                        '<:cyangreen:1324226321253142539>': 'cyan-green',
                        '<:cyan:1324226273794461706>': 'light blue',
                        '<:bluecyan:1324224790164144128>': 'blue',
                        '<:darkblue:1324224216651923519>': 'dark blue',
                    };

                    // Map for custom emojis (used in the message)
                    const customEmojiMap = {
                        '<:red:1324226477268406353>': '<:red:1324226477268406353>',
                        '<:orangered:1324226458465337365>': '<:orangered:1324226458465337365>',
                        '<:orange:1324226439796621322>': '<:orange:1324226439796621322>',
                        '<:yelloworange:1324226423568728074>': '<:yelloworange:1324226423568728074>',
                        '<:yellow:1324226408783810603>': '<:yellow:1324226408783810603>',
                        '<:greenyellow:1324226389859373086>': '<:greenyellow:1324226389859373086>',
                        '<:green:1324226357663633508>': '<:green:1324226357663633508>',
                        '<:cyangreen:1324226321253142539>': '<:cyangreen:1324226321253142539>',
                        '<:cyan:1324226273794461706>': '<:cyan:1324226273794461706>',
                        '<:bluecyan:1324224790164144128>': '<:bluecyan:1324224790164144128>',
                        '<:darkblue:1324224216651923519>': '<:darkblue:1324224216651923519>',
                    };

                    const statusEmoji = activityStatusMap[color] || '⚪';
                    const customEmoji = customEmojiMap[color] || '⚪';
                    const statusWord = messageContentMap[color] || 'unknown';

                    // Update the bot's activity status (uses default emojis)
                    client.user.setPresence({
                        activities: [{ name: `the dot: ${statusEmoji}`, type: ActivityType.Watching }],
                        status: 'online',
                    });

                    const isBlue = ['<:cyan:1324226273794461706>', '<:bluecyan:1324224790164144128>', '<:darkblue:1324224216651923519>'].includes(color);

                    if (isBlue) {
                        const channel = await client.channels.fetch(CHANNEL_ID);

                        // If there's no active message, send a new one
                        if (!lastNotificationMessage) {
                            lastNotificationMessage = await channel.send({
                                content: `${customEmoji} **The dot is ${statusWord}!**`,
                                allowedMentions: { roles: [BLUE_ROLE_ID] }
                            });
                            lastBlueNotificationTime = Date.now(); // Update the last notification time
                            console.log(`Notification sent for color: ${color}`);
                        } else {
                            // Edit the existing message to reflect the current shade of blue
                            await lastNotificationMessage.edit({
                                content: `${customEmoji} **The dot is ${statusWord}!**`
                            });
                            console.log(`Edited message to reflect color: ${color}`);
                        }
                    } else {
                        // If the dot is no longer blue
                        const now = Date.now();
                        if (lastNotificationMessage && now - lastBlueNotificationTime >= 60 * 60 * 1000) {
                            try {
                                await lastNotificationMessage.delete();
                                lastNotificationMessage = null;
                                console.log('Deleted the last notification message as the dot is no longer blue.');
                            } catch (error) {
                                console.warn('Failed to delete the last notification message:', error.message);
                            }
                        }
                    }

                    // Update the last detected color
                    lastColor = color;
                }
            } catch (error) {
                console.error('Error in color detection loop:', error);
            }
        }, 15000);

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