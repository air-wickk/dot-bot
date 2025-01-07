// node bot.js to run
const puppeteer = require('puppeteer');
const { Client, GatewayIntentBits, SlashCommandBuilder, ActivityType, REST, Routes } = require('discord.js');
const express = require('express');
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

// 📊 Color Tracking Data with Limit
const colorLog = [];
const MAX_COLOR_LOG_SIZE = 100; // Limit the log to the last 100 entries

// Update log with size restriction
function addToColorLog(color) {
    colorLog.push({ color, timestamp: Date.now() });
    if (colorLog.length > MAX_COLOR_LOG_SIZE) {
        colorLog.shift(); // Remove the oldest entry
    }
}

function wasBlueRecently() {
    return colorLog.slice(-20).some(entry => 
        ['<:bluecyan:1324224790164144128>', '<:darkblue:1324224216651923519>'].includes(entry.color)
    );
}

// 📊 Function to classify color into categories using Euclidean distance
function classifyColor(r, g, b) {
    const hsl = rgbToHsl(r, g, b);
    const hue = hsl[0];
    const saturation = hsl[1];
    const lightness = hsl[2];

    // Mapping the hue to the closest custom emojis based on hue values
    const colors = [
        { emoji: '<:red:1324226477268406353>', min: 0, max: 10 }, // Red
        { emoji: '<:orangered:1324226458465337365>', min: 10, max: 30 }, // Orange-Red
        { emoji: '<:orange:1324226439796621322>', min: 30, max: 50 }, // Orange
        { emoji: '<:yelloworange:1324226423568728074>', min: 50, max: 70 }, // Yellow-Orange
        { emoji: '<:yellow:1324226408783810603>', min: 70, max: 90 }, // Yellow
        { emoji: '<:greenyellow:1324226389859373086>', min: 90, max: 120 }, // Green-Yellow
        { emoji: '<:green:1324226357663633508>', min: 120, max: 150 }, // Green
        { emoji: '<:cyangreen:1324226321253142539>', min: 150, max: 170 }, // Cyan-Green
        { emoji: '<:cyan:1324226273794461706>', min: 170, max: 195 }, // Cyan
        { emoji: '<:bluecyan:1324224790164144128>', min: 195, max: 220 }, // Blue-Cyan
        { emoji: '<:darkblue:1324224216651923519>', min: 220, max: 255 }, // Dark Blue
    ];

    let closestColor = '<:pink:1326324208279490581>'; // Default to pink if no match

    for (let color of colors) {
        if (hue >= color.min && hue < color.max) {
            closestColor = color.emoji;
            break;
        }
    }

    // Special case for anomaly detection (e.g., highly desaturated or light pinks)
    if (closestColor === '<:pink:1326324208279490581>' && saturation < 30 && lightness > 70) {
        closestColor = '<:pink:1326324208279490581>';
    }

    return closestColor;
}

// 📊 Function to convert RGB to HSL
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else if (max === b) h = (r - g) / d + 4;
        h /= 6;
    }
    return [h * 360, s, l];
}

async function getCenterColor(page, retries = 3) {
    try {
        let screenshot;

        // Retry mechanism for taking a screenshot
        for (let i = 0; i < retries; i++) {
            try {
                // Ensure the page is valid and open
                if (!page || page.isClosed()) {
                    console.warn('Page is closed or invalid. Restarting browser...');
                    await launchBrowser();
                    return null;
                }

                // Ensure the page is fully loaded
                const isPageOk = await page.evaluate(() => document.readyState === 'complete');
                if (!isPageOk) {
                    console.warn('Page is not fully loaded. Reloading...');
                    await page.reload({ waitUntil: 'load' });
                    await new Promise(r => setTimeout(r, 2000)); // Wait after reload
                }

                // Take the screenshot
                await new Promise(r => setTimeout(r, 2000)); // Small delay to ensure stability
                screenshot = await page.screenshot({
                    fullPage: true,
                    encoding: 'base64',
                    timeout: 60000, // Increased timeout
                });

                if (screenshot) break; // Exit retry loop on successful screenshot

            } catch (error) {
                console.warn(`Retry ${i + 1}: Failed to take screenshot`, error.message);
                if (i === retries - 1) throw error; // Fail after final retry
                await new Promise(res => setTimeout(res, 2000)); // Wait before retrying
            }
        }

        if (!screenshot) {
            console.error('Failed to capture screenshot after retries.');
            return null;
        }

        // Evaluate the center color using the screenshot
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
        }, screenshot); // Pass `screenshot` to evaluate

        return classifyColor(color[0], color[1], color[2]); // Assuming `classifyColor` exists

    } catch (error) {
        console.error('Error in getCenterColor:', error.message);
        return null;
    }
}

// 🚨 Monitor center color and send Discord alerts for "Blue"
async function monitorColor() {
    let browser, page;
    try {
        async function launchBrowser() {
            if (browser) await browser.close(); // Close existing browser
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage'
                ]
            });
            page = await browser.newPage();
            await page.goto('https://global-mind.org/gcpdot/gcp.html', { waitUntil: 'networkidle0' });
        }

        // Launch browser initially
        await launchBrowser();

        let lastColor = null;
        let blueAnnounced = false;

        setInterval(async () => {
            try {
                if (!browser || !page || (page.isClosed && page.isClosed())) {
                    console.log('Re-initializing browser...');
                    await launchBrowser();
                }
        
                const color = await getCenterColor(page);
                let statusEmoji = '🔵'; // Default to blue for the activity status
                
                if (color && color !== lastColor) {
                    addToColorLog(color);
                
                    // Map specific colors to general emojis
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
                        '<:pink:1326324208279490581>': '⚪' // Map pink anomaly to white
                    };
                
                    statusEmoji = colorMap[color] || '⚪'; // Default to white if not mapped (anomaly)
        
                    // Update bot activity status
                    client.user.setPresence({
                        activities: [{ name: `the dot: ${statusEmoji}`, type: ActivityType.Watching }],
                        status: 'online',
                    });
        
                    // Handle blue announcements with cooldown
                    if (['<:bluecyan:1324224790164144128>', '<:darkblue:1324224216651923519>'].includes(color)) {
                        if (!blueAnnounced && !wasBlueRecently()) {
                            const channel = await client.channels.fetch(CHANNEL_ID);
                            await channel.send({
                                content: `<:darkblue:1324224216651923519> **The dot is blue!**`,
                                allowedMentions: { roles: [BLUE_ROLE_ID] }
                            });
                            blueAnnounced = true;
                        }
                    } else {
                        if (blueAnnounced) {
                            blueAnnounced = false; // Reset if the color changes
                        }
                    }
        
                    lastColor = color;
                }
            } catch (error) {
                console.error('Error in color detection loop:', error);
            }
        }, 15000);        

        // Restart the browser every hour
        setInterval(async () => {
            console.log("Restarting browser...");
            await launchBrowser();
        }, 1800000); // 30 mins in milliseconds

    } catch (error) {
        console.error("Error during color monitoring:", error);
    }
}

// 🗨️ Commands
client.on('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}!`);
    
    /* Delete global commands

    const clientId = "1323744486811111473"; // bot's client ID here
    const commandId = "1324218706997542913"; // command ID to delete

    const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
    try {
        await rest.delete(Routes.applicationCommand(clientId, commandId));
        console.log('Successfully deleted the global command');
    } catch (error) {
        console.error('Error deleting command:', error);
    }
    */

    // Register new command
    await client.application.commands.create(
        new SlashCommandBuilder().setName('dotcolor').setDescription('Get the current color of the dot!')
    );
    
    monitorColor();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'dotcolor') {
        await interaction.reply('🔍 Checking the dot, please wait...');
        const color = colorLog[colorLog.length - 1]?.color || 'Unknown';
        await interaction.editReply(`**The dot is** ${color} **right now**`);
    }
});

client.login(BOT_TOKEN);